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
  on,
  PushReceiptsDue,
  RetentionDue,
  TrustAdded,
  UserDeleted,
} from "@lib/contracts";
import { type Clock } from "@lib/kernel";
import { purgeMessagingTables } from "@lib/messaging";
import { DATABASE, MessagingRuntime, PollingLoop } from "@lib/platform";
import { DeliveryService } from "../application/delivery.service.js";
import { NotificationEvents } from "../application/notification-events.js";
import {
  CLOCK,
  NOTIFIER_STORES,
  type NotifierStores,
} from "../application/ports.js";

/**
 * The notifier's background work: consumes its queue (events → notifications), and sends the
 * pushes once the transactions that created them have committed.
 */
@Injectable()
export class NotifierMessaging
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger("Messaging");
  private readonly runtime: MessagingRuntime;
  private readonly deliveries: PollingLoop;

  constructor(
    @Inject(DATABASE) db: Kysely<any>,
    @Inject(NOTIFIER_STORES) stores: NotifierStores,
    @Inject(CLOCK) clock: Clock,
    events: NotificationEvents,
    delivery: DeliveryService,
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
        on(TrustAdded, (payload, _event, tx) =>
          events.trustAdded(stores.bind(tx), payload),
        ),
        on(UserDeleted, ({ userId }, _event, tx) =>
          events.userDeleted(stores.bind(tx), userId),
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
  }

  onApplicationBootstrap(): void {
    if (this.config.get("MESSAGING_ENABLED") === "false") return;
    this.runtime.start();
    this.deliveries.start();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.runtime.stop(), this.deliveries.stop()]);
  }
}
