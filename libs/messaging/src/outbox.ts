import type { Kysely } from "kysely";
import type { Clock } from "@lib/kernel";
import {
  createEnvelope,
  type EventContext,
  type EventEnvelope,
  type NewEvent,
} from "./envelope.js";
import type { Executor } from "./message-bus.js";
import { type ServiceMessagingTables, withTables } from "./tables.js";

export interface OutboxOptions {
  /** Schema of the publishing service (core, handover, notify, ops). */
  schema: string;
  context: EventContext;
  clock: Clock;
}

/**
 * Publishes events inside the caller's transaction: they exist if and only if the state change
 * that produced them commits. The relay delivers them afterwards.
 */
export class TransactionalOutbox {
  private readonly db: Kysely<ServiceMessagingTables>;

  constructor(
    tx: Executor,
    private readonly options: OutboxOptions,
  ) {
    this.db = withTables<ServiceMessagingTables>(tx).withSchema(options.schema);
  }

  /** `deliverAt` delays delivery, e.g. to fire when a deadline is reached. */
  async publish<P>(
    event: NewEvent<P>,
    { deliverAt }: { deliverAt?: Date } = {},
  ): Promise<EventEnvelope<P>> {
    const envelope = createEnvelope(
      event,
      this.options.context,
      this.options.clock,
    );
    await this.db
      .insertInto("outbox")
      .values({
        event_id: envelope.id,
        type: envelope.type,
        envelope: JSON.stringify(envelope),
        deliver_at: deliverAt ?? null,
      })
      .execute();
    return envelope;
  }
}
