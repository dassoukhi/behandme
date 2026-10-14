import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Kysely } from "kysely";
import { on, RetentionDue, SchedulerTick } from "@lib/contracts";
import { systemClock } from "@lib/kernel";
import { purgeMessagingTables } from "@lib/messaging";
import { DATABASE, MessagingRuntime } from "@lib/platform";
import {
  SCHEDULER_STORES,
  type SchedulerStores,
} from "../application/ports.js";
import { SchedulerService } from "../application/scheduler.service.js";

/** Consumes the worker's queue (ticks from pg_cron) and relays ops.outbox. */
@Injectable()
export class WorkerMessaging
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger("Messaging");
  private readonly runtime: MessagingRuntime;

  constructor(
    @Inject(DATABASE) db: Kysely<any>,
    @Inject(SCHEDULER_STORES) stores: SchedulerStores,
    scheduler: SchedulerService,
    private readonly config: ConfigService,
  ) {
    const logger = this.logger;
    this.runtime = new MessagingRuntime({
      db,
      schema: "ops",
      queue: "worker",
      logger,
      handlers: Object.fromEntries([
        on(SchedulerTick, async (_payload, event, tx) => {
          const fired = await scheduler.onTick(stores.bind(tx, event));
          if (fired.length) logger.log(`Jobs due: ${fired.join(", ")}`);
        }),
        on(RetentionDue, async (_payload, event, tx) => {
          const runs = await scheduler.purge(stores.bind(tx, event));
          const messaging = await purgeMessagingTables(
            tx,
            "ops",
            systemClock.now(),
          );
          logger.log(
            `Retention: ${runs} job runs, ${messaging.outbox} outbox rows, ` +
              `${messaging.processed} processed ids deleted`,
          );
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
