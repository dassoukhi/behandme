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
import { KeyCareDue, on, RetentionDue } from "@lib/contracts";
import { systemClock } from "@lib/kernel";
import { purgeMessagingTables } from "@lib/messaging";
import { DATABASE, MessagingRuntime } from "@lib/platform";
import { KeyCareService } from "../keys/application/key-care.service.js";
import { KyselyKeysUnitOfWork } from "../keys/infrastructure/kysely-keys.unit-of-work.js";
import { KeysModule } from "../keys/keys.module.js";

/** Relays core.outbox to the other services and handles the events sent to the gateway's queue. */
@Injectable()
class GatewayMessaging implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Messaging");
  private readonly runtime: MessagingRuntime;

  constructor(
    @Inject(DATABASE) db: Kysely<any>,
    private readonly config: ConfigService,
    keyCare: KeyCareService,
    keysUnitOfWork: KyselyKeysUnitOfWork,
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
          // Transfers nobody took: their wraps go too.
          const transfers = await keysUnitOfWork
            .bind(tx as Kysely<any>)
            .transfers.deleteExpired(systemClock.now());
          this.logger.log(
            `Retention: ${purged.outbox} outbox rows, ${purged.processed} processed ids, ${transfers} expired key transfers deleted`,
          );
        }),
        on(KeyCareDue, async (_payload, _event, tx) => {
          const reminded = await keyCare.remind(
            keysUnitOfWork.bind(tx as Kysely<any>),
          );
          this.logger.log(`Key care: ${reminded} reminder(s)`);
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

@Module({ imports: [KeysModule], providers: [GatewayMessaging] })
export class MessagingModule {}
