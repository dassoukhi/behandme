import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Kysely } from "kysely";
import {
  ClaimClosed,
  ClaimFiled,
  ClaimQuorumReached,
  ClaimReminder,
  ContractReleased,
  ContractRevoked,
  ContractSealed,
  KeyCareReminder,
  KeysBackupOpened,
  KeysRotated,
  KeysTransferred,
  ParticipantLeft,
  on,
  PushReceiptsDue,
  RetentionDue,
  TrustAdded,
  UserDeleted,
  UserProfileChanged,
} from "@lib/contracts";
import { type Clock } from "@lib/kernel";
import { purgeMessagingTables } from "@lib/messaging";
import { DATABASE, MessagingRuntime, PollingLoop } from "@lib/platform";
import { DeliveryService } from "../application/delivery.service.js";
import { EmailDeliveryService } from "../application/email-delivery.service.js";
import { NotificationEvents } from "../application/notification-events.js";
import {
  CLOCK,
  EMAIL_GATEWAY,
  type EmailGateway,
  NOTIFIER_STORES,
  type NotifierStores,
} from "../application/ports.js";

/**
 * The notifier's background work: consumes its queue (events → notifications), and sends the
 * pushes and e-mails once the transactions that created them have committed.
 */
@Injectable()
export class NotifierMessaging
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger("Messaging");
  private readonly runtime: MessagingRuntime;
  private readonly deliveries: PollingLoop;
  private readonly emails: PollingLoop;

  constructor(
    @Inject(DATABASE) db: Kysely<any>,
    @Inject(NOTIFIER_STORES) stores: NotifierStores,
    @Inject(CLOCK) clock: Clock,
    events: NotificationEvents,
    delivery: DeliveryService,
    emailDelivery: EmailDeliveryService,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    private readonly config: ConfigService,
  ) {
    const logger = this.logger;
    this.runtime = new MessagingRuntime({
      db,
      schema: "notify",
      queue: "notifier",
      logger,
      // The notifier publishes no event yet.
      relay: false,
      handlers: Object.fromEntries([
        on(TrustAdded, (payload, event, tx) =>
          events.trustAdded(stores.bind(tx), payload, event.occurredAt),
        ),
        on(KeysRotated, (payload, event, tx) =>
          events.keysRotated(stores.bind(tx), payload, event.occurredAt),
        ),
        on(KeyCareReminder, (payload, event, tx) =>
          events.keyCareReminder(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ContractSealed, (payload, event, tx) =>
          events.contractSealed(stores.bind(tx), payload, event.occurredAt),
        ),
        on(KeysTransferred, (payload, event, tx) =>
          events.keysTransferred(stores.bind(tx), payload, event.occurredAt),
        ),
        on(KeysBackupOpened, (payload, event, tx) =>
          events.keysBackupOpened(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ClaimFiled, (payload, event, tx) =>
          events.claimFiled(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ClaimQuorumReached, (payload, event, tx) =>
          events.claimQuorumReached(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ClaimReminder, (payload, event, tx) =>
          events.claimReminder(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ClaimClosed, (payload, event, tx) =>
          events.claimClosed(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ContractReleased, (payload, event, tx) =>
          events.contractReleased(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ContractRevoked, (payload, event, tx) =>
          events.contractRevoked(stores.bind(tx), payload, event.occurredAt),
        ),
        on(ParticipantLeft, (payload, event, tx) =>
          events.participantLeft(stores.bind(tx), payload, event.occurredAt),
        ),
        on(UserDeleted, ({ userId }, event, tx) =>
          events.userDeleted(stores.bind(tx), userId, event.occurredAt),
        ),
        on(UserProfileChanged, (payload, event, tx) =>
          events.userProfileChanged(stores.bind(tx), payload, event.occurredAt),
        ),
        on(PushReceiptsDue, async (_payload, _event, tx) => {
          const result = await delivery.checkReceipts(stores.bind(tx));
          logger.log(
            `Push receipts: ${result.delivered} delivered, ${result.failed} failed`,
          );
        }),
        on(RetentionDue, async (_payload, _event, tx) => {
          const purged = await events.retention(stores.bind(tx));
          const messaging = await purgeMessagingTables(
            tx,
            "notify",
            clock.now(),
          );
          logger.log(
            `Retention: ${purged.notifications} notifications, ${purged.deliveries} deliveries, ` +
              `${purged.emails} e-mails, ${purged.forgotten} deleted accounts, ` +
              `${messaging.processed} processed ids deleted`,
          );
        }),
      ]),
    });
    this.deliveries = new PollingLoop({
      name: "push deliveries",
      run: () => delivery.sendDue(logger),
      logger,
    });
    this.emails = new PollingLoop({
      name: "e-mail deliveries",
      run: () => emailDelivery.sendDue(logger),
      logger,
    });
  }

  onApplicationBootstrap(): void {
    if (this.config.get("MESSAGING_ENABLED") === "false") return;
    this.runtime.start();
    this.deliveries.start();
    if (this.email.enabled) {
      this.emails.start();
    } else {
      this.logger.warn("E-mail is off: RESEND_API_KEY is not set");
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.runtime.stop(),
      this.deliveries.stop(),
      this.emails.stop(),
    ]);
  }
}
