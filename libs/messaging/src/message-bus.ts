import type { Kysely } from "kysely";
import type { EventEnvelope } from "./envelope.js";

/** A connection or an open transaction; the Postgres transport joins the caller's transaction. */
export type Executor = Kysely<any>;

export interface ReceivedMessage {
  /** Transport id, used to acknowledge or dead-letter the message. */
  id: string;
  /** Deliveries so far, this one included. */
  attempts: number;
  body: unknown;
}

/**
 * Port of the message transport: one queue per consuming service. A message read and not
 * acknowledged becomes visible again after the visibility timeout (at-least-once delivery).
 */
export interface MessageBus {
  send(
    db: Executor,
    queue: string,
    message: EventEnvelope,
    delaySeconds?: number,
  ): Promise<void>;
  receive(
    db: Executor,
    queue: string,
    options: { max: number; visibilitySeconds: number },
  ): Promise<ReceivedMessage[]>;
  /** The message is handled: remove it. */
  ack(db: Executor, queue: string, id: string): Promise<void>;
  /** Give up on the message: keep it aside for inspection, out of the queue. */
  deadLetter(db: Executor, queue: string, id: string): Promise<void>;
}
