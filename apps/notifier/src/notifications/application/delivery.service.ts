import { Inject, Injectable } from "@nestjs/common";
import { type Clock, type Logger } from "@lib/kernel";
import {
  interpretOutcome,
  MAX_SEND_ATTEMPTS,
  retryDelayMs,
} from "../domain/push.js";
import {
  CLOCK,
  NOTIFIER_STORES,
  PUSH_GATEWAY,
  type NotifierStore,
  type NotifierStores,
  type PushGateway,
} from "./ports.js";

const BATCH = 100;
/** Expo publishes receipts within minutes; ask once they are surely there. */
const RECEIPT_DELAY_MS = 15 * 60_000;
const RECEIPT_TTL_MS = 24 * 3_600_000;

/** Sends the pending pushes, then checks Expo's receipts for them. */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(NOTIFIER_STORES) private readonly stores: NotifierStores,
    @Inject(PUSH_GATEWAY) private readonly push: PushGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Sends one batch of due pushes; returns how many were handled. A send that fails (Expo down)
   * is retried later with a growing delay, then given up after MAX_SEND_ATTEMPTS.
   */
  async sendDue(logger: Logger): Promise<number> {
    return this.stores.transaction(async (store) => {
      const now = this.clock.now();
      const due = await store.deliveries.lockDue(now, BATCH);
      if (due.length === 0) return 0;

      let outcomes;
      try {
        outcomes = await this.push.send(
          due.map((d) => ({ ...d.message, to: d.token })),
        );
      } catch (error) {
        const reason = (error as Error).message;
        for (const delivery of due) {
          const attempts = delivery.attempts + 1;
          if (attempts >= MAX_SEND_ATTEMPTS) {
            await store.deliveries.markFailed(delivery.id, reason, now);
          } else {
            await store.deliveries.postpone(
              delivery.id,
              reason,
              new Date(now.getTime() + retryDelayMs(attempts)),
            );
          }
        }
        logger.warn(`Push send failed for ${due.length} deliveries: ${reason}`);
        return due.length;
      }

      const gone: string[] = [];
      for (const [i, delivery] of due.entries()) {
        const outcome = outcomes[i];
        const { failed, error, deviceGone } = interpretOutcome(outcome);
        if (deviceGone) gone.push(delivery.token);
        if (failed || outcome.status !== "ok" || !outcome.id) {
          await store.deliveries.markFailed(
            delivery.id,
            error ?? "No ticket",
            now,
          );
        } else {
          await store.deliveries.markSent(delivery.id, outcome.id, now);
        }
      }
      await store.tokens.remove(gone);
      return due.length;
    });
  }

  /**
   * Records Expo's receipts for pushes sent at least 15 minutes ago and forgets dead devices, in
   * `store`'s transaction (the one of the event that asked for it).
   */
  async checkReceipts(
    store: NotifierStore,
  ): Promise<{ delivered: number; failed: number }> {
    const now = this.clock.now();
    const awaiting = await store.deliveries.lockAwaitingReceipt(
      new Date(now.getTime() - RECEIPT_DELAY_MS),
      1000,
    );
    if (awaiting.length === 0) return { delivered: 0, failed: 0 };

    const receipts = await this.push.receipts(
      awaiting.map((d) => d.ticket_id!),
    );
    const result = { delivered: 0, failed: 0 };
    const gone: string[] = [];
    for (const delivery of awaiting) {
      let receipt = receipts.get(delivery.ticket_id!);
      if (!receipt) {
        // Not ready yet: ask again next time. Expo keeps receipts for a day; past that, count
        // the push as delivered rather than resend it and risk a duplicate.
        if (now.getTime() - delivery.sent_at!.getTime() < RECEIPT_TTL_MS) {
          continue;
        }
        receipt = { status: "ok" };
      }
      const { failed, error, deviceGone } = interpretOutcome(receipt);
      if (deviceGone) gone.push(delivery.token);
      if (failed) {
        await store.deliveries.markFailed(delivery.id, error!, now);
        result.failed++;
      } else {
        await store.deliveries.markDelivered(delivery.id, now);
        result.delivered++;
      }
    }
    await store.tokens.remove(gone);
    return result;
  }
}
