import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Kysely } from "kysely";
import { AuditVerifyDue, on, RetentionDue, UserDeleted } from "@lib/contracts";
import { systemClock } from "@lib/kernel";
import { purgeMessagingTables } from "@lib/messaging";
import { DATABASE, MessagingRuntime } from "@lib/platform";
import { HandoverEvents } from "../application/handover-events.js";
import { HANDOVER_STORES, type HandoverStores } from "../application/ports.js";

/** Consumes handover's queue. Handover publishes no event yet (phase 4: contract.sealed…). */
@Injectable()
export class HandoverMessaging
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger("Messaging");
  private readonly runtime: MessagingRuntime;

  constructor(
    @Inject(DATABASE) db: Kysely<any>,
    @Inject(HANDOVER_STORES) stores: HandoverStores,
    events: HandoverEvents,
    private readonly config: ConfigService,
  ) {
    const logger = this.logger;
    this.runtime = new MessagingRuntime({
      db,
      schema: "handover",
      queue: "handover",
      logger,
      relay: false,
      handlers: Object.fromEntries([
        on(UserDeleted, async ({ userId }, _event, tx) => {
          const deleted = await events.userDeleted(stores.bind(tx), userId);
          if (deleted)
            logger.log(`Deleted ${deleted} drafts of a deleted account`);
        }),
        on(AuditVerifyDue, async (_payload, _event, tx) => {
          const { checked, broken } = await events.verifyAll(
            stores.bind(tx),
            logger,
          );
          logger.log(
            `Audit logs verified: ${checked} contracts, ${broken.length} broken`,
          );
        }),
        on(RetentionDue, async (_payload, _event, tx) => {
          const purged = await purgeMessagingTables(
            tx,
            "handover",
            systemClock.now(),
          );
          logger.log(`Retention: ${purged.processed} processed ids deleted`);
        }),
      ]),
    });
  }

  onApplicationBootstrap(): void {
    if (this.config.get("MESSAGING_ENABLED") !== "false") this.runtime.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runtime.stop();
  }
}
