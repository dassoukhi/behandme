import { sql } from "kysely";
import type { EventEnvelope } from "./envelope.js";
import type { Executor, MessageBus, ReceivedMessage } from "./message-bus.js";

/**
 * MessageBus on Supabase Queues (pgmq), in the same database as the services' data, so sending
 * from an open transaction commits or rolls back with it. Sending goes through `messaging.send`
 * (migration 20261013230000), which needs no right on the target queue's tables.
 */
export class PgmqBus implements MessageBus {
  async send(
    db: Executor,
    queue: string,
    message: EventEnvelope,
    delaySeconds = 0,
  ): Promise<void> {
    await sql`select messaging.send(${queue}, ${JSON.stringify(message)}::jsonb, ${delaySeconds}::int)`.execute(
      db,
    );
  }

  async receive(
    db: Executor,
    queue: string,
    { max, visibilitySeconds }: { max: number; visibilitySeconds: number },
  ): Promise<ReceivedMessage[]> {
    const { rows } = await sql<{
      msg_id: string;
      read_ct: number;
      message: unknown;
    }>`select msg_id, read_ct, message from pgmq.read(${queue}, ${visibilitySeconds}::int, ${max}::int)`.execute(
      db,
    );
    return rows.map((row) => ({
      id: String(row.msg_id),
      attempts: row.read_ct,
      body: row.message,
    }));
  }

  async ack(db: Executor, queue: string, id: string): Promise<void> {
    await sql`select pgmq.delete(${queue}, ${id}::bigint)`.execute(db);
  }

  async deadLetter(db: Executor, queue: string, id: string): Promise<void> {
    await sql`select pgmq.archive(${queue}, ${id}::bigint)`.execute(db);
  }
}
