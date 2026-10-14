import { Inject, Injectable } from "@nestjs/common";
import type { Kysely } from "kysely";
import { currentCorrelationId, newId, systemClock } from "@lib/kernel";
import { TransactionalOutbox } from "@lib/messaging";
import { DATABASE } from "@lib/platform";
import type {
  UsersTransaction,
  UsersUnitOfWork,
} from "../application/ports.js";
import { KyselyProfileRepository } from "./kysely-profile.repository.js";
import { KyselyTrustRepository } from "./kysely-trust.repository.js";
import type { UsersDatabase } from "./tables.js";

/** One database transaction; events go to core.outbox in it (see libs/messaging). */
@Injectable()
export class KyselyUsersUnitOfWork implements UsersUnitOfWork {
  constructor(@Inject(DATABASE) private readonly db: Kysely<UsersDatabase>) {}

  run<T>(work: (tx: UsersTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((tx) => {
      const outbox = new TransactionalOutbox(tx, {
        schema: "core",
        context: { correlationId: currentCorrelationId() ?? newId() },
        clock: systemClock,
      });
      return work({
        profiles: new KyselyProfileRepository(tx),
        trust: new KyselyTrustRepository(tx),
        events: {
          publish: async (event) => {
            await outbox.publish(event);
          },
        },
      });
    });
  }
}
