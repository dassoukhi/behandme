import { sql } from "kysely";
import type { Executor } from "./message-bus.js";
import { type ServiceMessagingTables, withTables } from "./tables.js";

export interface MessagingRetention {
  /** Days a relayed outbox row is kept, for inspection. */
  sentDays: number;
  /** Days an event id is remembered as processed. Longer than any redelivery can take. */
  processedDays: number;
}

export const DEFAULT_MESSAGING_RETENTION: MessagingRetention = {
  sentDays: 7,
  processedDays: 30,
};

/** Deletes the outbox rows and processed-message records a service no longer needs. */
export async function purgeMessagingTables(
  db: Executor,
  schema: string,
  now: Date,
  retention: MessagingRetention = DEFAULT_MESSAGING_RETENTION,
): Promise<{ outbox: number; processed: number }> {
  const tables = withTables<ServiceMessagingTables>(db).withSchema(schema);
  const daysAgo = (days: number) =>
    sql<Date>`${now.toISOString()}::timestamptz - make_interval(days => ${days})`;
  const outbox = await tables
    .deleteFrom("outbox")
    .where("sent_at", "<", daysAgo(retention.sentDays))
    .executeTakeFirst();
  const processed = await tables
    .deleteFrom("processed_messages")
    .where("processed_at", "<", daysAgo(retention.processedDays))
    .executeTakeFirst();
  return {
    outbox: Number(outbox.numDeletedRows),
    processed: Number(processed.numDeletedRows),
  };
}
