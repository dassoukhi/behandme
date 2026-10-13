import type { ColumnType, Generated, Kysely } from "kysely";
import type { EventEnvelope } from "./envelope.js";
import type { Executor } from "./message-bus.js";

// Tables created by migration 20261013230000_service_schemas_and_messaging.sql.

/** `<service schema>.outbox` */
export interface OutboxTable {
  id: Generated<string>;
  event_id: string;
  type: string;
  envelope: ColumnType<EventEnvelope, string, never>;
  deliver_at: Date | null;
  created_at: Generated<Date>;
  sent_at: Date | null;
}

/** `<service schema>.processed_messages` */
export interface ProcessedMessagesTable {
  consumer: string;
  event_id: string;
  processed_at: Generated<Date>;
}

/** Tables every service schema has. */
export interface ServiceMessagingTables {
  outbox: OutboxTable;
  processed_messages: ProcessedMessagesTable;
}

/** `messaging` schema. */
export interface RoutingTables {
  subscriptions: { event_type: string; queue: string };
}

/** The caller's connection or transaction, typed with the tables above. */
export function withTables<DB>(db: Executor): Kysely<DB> {
  return db as unknown as Kysely<DB>;
}
