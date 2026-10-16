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
  AuditVerifyDue,
  ClaimDeadlineDue,
  ClaimReminderDue,
  ClaimsDue,
  on,
  RetentionDue,
  UserDeleted,
} from "@lib/contracts";
import { systemClock } from "@lib/kernel";
import { purgeMessagingTables } from "@lib/messaging";
import { DATABASE, MessagingRuntime } from "@lib/platform";
import { ClaimsService } from "../application/claims.service.js";
import { HandoverEvents } from "../application/handover-events.js";
import { HANDOVER_STORES, type HandoverStores } from "../application/ports.js";

/** Relays handover.outbox (claims, release) and consumes handover's queue. */
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
    claims: ClaimsService,
    private readonly config: ConfigService,
  ) {
    const logger = this.logger;
    this.runtime = new MessagingRuntime({
      db,
      schema: "handover",
      queue: "handover",
      logger,
      handlers: Object.fromEntries([
        on(ClaimDeadlineDue, async ({ claimId }, _event, tx) => {
          const outcome = await claims.settle(stores.bind(tx), claimId);
          logger.log(`Claim ${claimId} at its deadline: ${outcome}`);
        }),
        on(ClaimReminderDue, async ({ claimId }, _event, tx) => {
          await claims.remind(stores.bind(tx), claimId);
        }),
        on(ClaimsDue, async (_payload, _event, tx) => {
          const { released, expired } = await claims.settleDue(stores.bind(tx));
          logger.log(`Due claims: ${released} released, ${expired} expired`);
        }),
        on(UserDeleted, async ({ userId }, _event, tx) => {
          const { deleted, revoked, left } = await events.userDeleted(
            stores.bind(tx),
            userId,
          );
          logger.log(
            `Deleted account: ${deleted} drafts deleted, ${revoked} contracts revoked, left ${left} others'`,
          );
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
