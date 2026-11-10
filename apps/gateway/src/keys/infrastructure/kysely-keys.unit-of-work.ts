import { Inject, Injectable } from "@nestjs/common";
import type { Kysely } from "kysely";
import { currentCorrelationId, newId, systemClock } from "@lib/kernel";
import { TransactionalOutbox } from "@lib/messaging";
import { DATABASE } from "@lib/platform";
import type { KeysTransaction, KeysUnitOfWork } from "../application/ports.js";
import { KyselyKeyTransferRepository } from "./kysely-key-transfer.repository.js";
import { KyselyKeyRepository } from "./kysely-key.repository.js";

/** One database transaction; events go to core.outbox in it (see libs/messaging). */
@Injectable()
export class KyselyKeysUnitOfWork implements KeysUnitOfWork {
  constructor(@Inject(DATABASE) private readonly db: Kysely<any>) {}

  run<T>(work: (tx: KeysTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((tx) => work(this.bind(tx)));
  }

  /** The same, inside a transaction already open (a consumer handling a message). */
  bind(tx: Kysely<any>): KeysTransaction {
    const outbox = new TransactionalOutbox(tx, {
      schema: "core",
      context: { correlationId: currentCorrelationId() ?? newId() },
      clock: systemClock,
    });
    return {
      keys: new KyselyKeyRepository(tx),
      transfers: new KyselyKeyTransferRepository(tx),
      events: {
        publish: async (event) => {
          await outbox.publish(event);
        },
      },
    };
  }
}
