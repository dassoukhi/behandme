import { type Logger, withCorrelation } from "@lib/kernel";
import { type EventEnvelope, isEnvelope } from "./envelope.js";
import type { Executor, MessageBus, ReceivedMessage } from "./message-bus.js";
import { MalformedMessageError } from "./errors.js";
import { type ServiceMessagingTables, withTables } from "./tables.js";

/**
 * Handles one event. All its writes must go through `tx`: they commit together with the record
 * that the event was processed, so a redelivered event has no second effect. It runs with the
 * event's correlation id (`currentCorrelationId()`), and throws `MalformedMessageError` for a
 * payload it cannot read: retrying would not help, so the message is dead-lettered at once.
 */
export type EventHandler = (
  event: EventEnvelope,
  tx: Executor,
) => Promise<void>;

export interface ConsumerOptions {
  /** Queue of the consuming service. */
  queue: string;
  /** Schema of the consuming service, which holds its processed_messages. */
  schema: string;
  bus: MessageBus;
  /** One handler per event type the service subscribed to. */
  handlers: Record<string, EventHandler>;
  logger: Logger;
  /** Deliveries before a failing message is dead-lettered. */
  maxAttempts?: number;
  /** Seconds a received message stays hidden before it can be delivered again. */
  visibilitySeconds?: number;
  batchSize?: number;
}

export interface PollResult {
  handled: number;
  duplicates: number;
  failed: number;
  deadLettered: number;
}

/** Reads a queue and runs each message's handler once (at-least-once delivery, idempotent effects). */
export class QueueConsumer {
  constructor(
    private readonly db: Executor,
    private readonly options: ConsumerOptions,
  ) {}

  /** Handles one batch. A failed message stays in the queue and comes back after the timeout. */
  async pollOnce(): Promise<PollResult> {
    const { bus, queue, batchSize = 10, visibilitySeconds = 30 } = this.options;
    const result: PollResult = {
      handled: 0,
      duplicates: 0,
      failed: 0,
      deadLettered: 0,
    };
    const messages = await bus.receive(this.db, queue, {
      max: batchSize,
      visibilitySeconds,
    });
    for (const message of messages) {
      await this.process(message, result);
    }
    return result;
  }

  private async process(
    message: ReceivedMessage,
    result: PollResult,
  ): Promise<void> {
    const {
      bus,
      queue,
      schema,
      handlers,
      logger,
      maxAttempts = 5,
    } = this.options;
    const envelope = message.body;

    const rejection = !isEnvelope(envelope)
      ? "is not an event envelope"
      : !Object.hasOwn(handlers, envelope.type)
        ? `has no handler for ${envelope.type}`
        : message.attempts > maxAttempts
          ? `failed ${maxAttempts} times`
          : null;
    if (rejection) {
      await bus.deadLetter(this.db, queue, message.id);
      logger.error(
        `Message ${message.id} on ${queue} ${rejection}: dead-lettered`,
      );
      result.deadLettered++;
      return;
    }
    const event = envelope as EventEnvelope;

    try {
      const firstTime = await withCorrelation(event.correlationId, () =>
        this.db.transaction().execute(async (tx) => {
          const recorded = await withTables<ServiceMessagingTables>(tx)
            .withSchema(schema)
            .insertInto("processed_messages")
            .values({ consumer: queue, event_id: event.id })
            .onConflict((oc) => oc.doNothing())
            .returning("event_id")
            .executeTakeFirst();
          if (recorded) await handlers[event.type](event, tx);
          return recorded !== undefined;
        }),
      );
      // After commit, so that any transport works: a crash before this line redelivers the
      // message, and processed_messages turns the redelivery into a no-op.
      await bus.ack(this.db, queue, message.id);
      if (firstTime) result.handled++;
      else result.duplicates++;
    } catch (error) {
      if (error instanceof MalformedMessageError) {
        await bus.deadLetter(this.db, queue, message.id);
        logger.error(
          `Message ${message.id} on ${queue} is a malformed ${event.type}: dead-lettered ` +
            `(${error.message})`,
        );
        result.deadLettered++;
        return;
      }
      result.failed++;
      logger.warn(
        `Handler for ${event.type} failed on event ${event.id} ` +
          `(attempt ${message.attempts}/${maxAttempts}): ${(error as Error).message}`,
      );
    }
  }
}
