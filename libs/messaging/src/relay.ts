import { sql } from "kysely";
import type { Logger } from "@lib/kernel";
import type { Executor, MessageBus } from "./message-bus.js";
import {
  type RoutingTables,
  type ServiceMessagingTables,
  withTables,
} from "./tables.js";

export interface RelayOptions {
  /** Schema whose outbox this relay drains (the service's own). */
  schema: string;
  bus: MessageBus;
  logger: Logger;
  batchSize?: number;
}

/**
 * Moves committed outbox events to the queue of every subscriber (`messaging.subscriptions`), then
 * marks them sent. Rows are locked with SKIP LOCKED, so several instances can run side by side.
 * With the Postgres transport, sending and marking commit together: each event is enqueued once.
 */
export class OutboxRelay {
  constructor(
    private readonly db: Executor,
    private readonly options: RelayOptions,
  ) {}

  /** Relays one batch; returns how many events it handled (0 when the outbox is empty). */
  async relayOnce(): Promise<number> {
    const { schema, bus, logger, batchSize = 50 } = this.options;
    return this.db.transaction().execute(async (tx) => {
      const outbox = withTables<ServiceMessagingTables>(tx).withSchema(schema);
      const pending = await outbox
        .selectFrom("outbox")
        .select([
          "id",
          "type",
          "envelope",
          // Seconds until deliver_at; 0 when absent or past.
          sql<number>`greatest(0, ceil(extract(epoch from deliver_at - now())))::int`.as(
            "delay",
          ),
        ])
        .where("sent_at", "is", null)
        .orderBy("id")
        .limit(batchSize)
        .forUpdate()
        .skipLocked()
        .execute();
      if (pending.length === 0) return 0;

      const routes = await withTables<RoutingTables>(tx)
        .withSchema("messaging")
        .selectFrom("subscriptions")
        .select(["event_type", "queue"])
        .where("event_type", "in", [...new Set(pending.map((e) => e.type))])
        .execute();

      for (const event of pending) {
        const queues = routes
          .filter((route) => route.event_type === event.type)
          .map((route) => route.queue);
        if (queues.length === 0) {
          logger.warn(
            `No subscriber for ${event.type}: event ${event.envelope.id} marked as sent`,
          );
        }
        for (const queue of queues) {
          await bus.send(tx, queue, event.envelope, event.delay);
        }
      }

      await outbox
        .updateTable("outbox")
        .set({ sent_at: sql`now()` })
        .where(
          "id",
          "in",
          pending.map((event) => event.id),
        )
        .execute();
      return pending.length;
    });
  }
}
