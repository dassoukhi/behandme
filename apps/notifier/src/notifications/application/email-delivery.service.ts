import { Inject, Injectable } from "@nestjs/common";
import { type Clock, type Logger } from "@lib/kernel";
import { MAX_SEND_ATTEMPTS, retryDelayMs } from "../domain/push.js";
import {
  CLOCK,
  EMAIL_GATEWAY,
  type EmailDelivery,
  type EmailGateway,
  NOTIFIER_STORES,
  type NotifierStores,
} from "./ports.js";

/** E-mails taken per run: sent one by one, as the provider limits requests per second. */
const BATCH = 10;
/** How long a sender holds the e-mails it took; past that, they are taken again (the sender died). */
const LEASE_MS = 10 * 60_000;
/** An e-mail still unsent after this is dropped: the dates it gives (a deadline to cancel) may be past. */
export const EMAIL_MAX_AGE_MS = 3 * 86_400_000;
/** Wait after the provider's rate limit. */
const RATE_LIMIT_WAIT_MS = 1_000;
/** Wait while the provider refuses the key, the sender or the domain. */
const MISCONFIGURED_WAIT_MS = 3_600_000;

/**
 * Sends the queued e-mails, outside any transaction: the provider is called with a key per e-mail, so
 * a retry after a crash does not send it twice. Never logs an address.
 */
@Injectable()
export class EmailDeliveryService {
  constructor(
    @Inject(NOTIFIER_STORES) private readonly stores: NotifierStores,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Sends one batch of due e-mails; returns how many were taken. */
  async sendDue(logger: Logger): Promise<number> {
    if (!this.email.enabled) return 0;
    const emails = this.stores.root.emails;
    const now = this.clock.now();
    const due = await emails.claimDue(
      now,
      new Date(now.getTime() + LEASE_MS),
      BATCH,
    );
    const outcomes = { sent: 0, failed: 0, later: 0 };

    for (const [i, delivery] of due.entries()) {
      if (now.getTime() - delivery.createdAt.getTime() > EMAIL_MAX_AGE_MS) {
        await emails.markFailed(
          delivery.notificationId,
          "Expired: not sent within 3 days",
          now,
        );
        outcomes.failed++;
        continue;
      }
      const result = await this.email.send({
        to: delivery.to,
        content: delivery.content,
        idempotencyKey: `notification-${delivery.notificationId}`,
      });
      switch (result.status) {
        case "sent":
          await emails.markSent(
            delivery.notificationId,
            result.id,
            this.clock.now(),
          );
          outcomes.sent++;
          break;
        case "rejected":
          await emails.markFailed(delivery.notificationId, result.error, now);
          outcomes.failed++;
          break;
        case "retry":
          if (delivery.attempts >= MAX_SEND_ATTEMPTS) {
            await emails.markFailed(delivery.notificationId, result.error, now);
            outcomes.failed++;
          } else {
            await emails.postpone(
              delivery.notificationId,
              result.error,
              new Date(now.getTime() + retryDelayMs(delivery.attempts)),
              true,
            );
            outcomes.later++;
          }
          break;
        case "rate_limited":
        case "quota":
        case "misconfigured": {
          // The rest of the batch would meet the same limit: give it all back, without counting a try.
          const until =
            result.status === "quota"
              ? nextUtcMidnight(now)
              : new Date(
                  now.getTime() +
                    (result.status === "misconfigured"
                      ? MISCONFIGURED_WAIT_MS
                      : RATE_LIMIT_WAIT_MS),
                );
          await this.giveBack(due.slice(i), result.error, until);
          outcomes.later += due.length - i;
          if (result.status === "quota") {
            logger.warn(
              `E-mail quota reached: ${due.length - i} e-mails wait until ${until.toISOString()}`,
            );
          } else if (result.status === "misconfigured") {
            logger.error(
              `E-mail refused by the provider's settings (${result.error.split(":")[0]}): ` +
                `${due.length - i} e-mails wait until ${until.toISOString()}`,
            );
          }
          this.log(logger, outcomes);
          // Nothing more is due before the wait: let the loop idle instead of asking again at once.
          return 0;
        }
      }
    }
    this.log(logger, outcomes);
    return due.length;
  }

  private async giveBack(
    deliveries: EmailDelivery[],
    error: string,
    until: Date,
  ): Promise<void> {
    for (const delivery of deliveries) {
      await this.stores.root.emails.postpone(
        delivery.notificationId,
        error,
        until,
        false,
      );
    }
  }

  private log(
    logger: Logger,
    { sent, failed, later }: { sent: number; failed: number; later: number },
  ): void {
    if (failed > 0 || later > 0) {
      logger.warn(
        `E-mails: ${sent} sent, ${failed} failed, ${later} to try again`,
      );
    }
  }
}

/** Midnight UTC after `now`: when the provider's daily quota starts again. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}
