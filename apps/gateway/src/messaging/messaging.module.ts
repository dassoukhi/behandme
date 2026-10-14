import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Kysely } from "kysely";
import { on, RetentionDue } from "@lib/contracts";
import { systemClock } from "@lib/kernel";
import { purgeMessagingTables } from "@lib/messaging";
import { DATABASE, MessagingRuntime } from "@lib/platform";

/** Relays core.outbox to the other services and handles the events sent to the gateway's queue. */
@Injectable()
class GatewayMessaging implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Messaging");
  private readonly runtime: MessagingRuntime;

  constructor(
    @Inject(DATABASE) db: Kysely<any>,
    private readonly config: ConfigService,
  ) {
    this.runtime = new MessagingRuntime({
      db,
      schema: "core",
      queue: "gateway",
      logger: this.logger,
      handlers: Object.fromEntries([
        on(RetentionDue, async (_payload, _event, tx) => {
          const purged = await purgeMessagingTables(
            tx,
            "core",
            systemClock.now(),
          );
          this.logger.log(
            `Retention: ${purged.outbox} outbox rows, ${purged.processed} processed ids deleted`,
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

@Module({ providers: [GatewayMessaging] })
export class MessagingModule {}
