import { type Clock, newId } from "@lib/kernel";

/** What travels between services: an event plus what is needed to trace and deduplicate it. */
export interface EventEnvelope<P = unknown> {
  /** Unique per event; consumers use it to drop duplicates. */
  id: string;
  /** Dotted name, e.g. "claim.filed". */
  type: string;
  /** Version of the payload schema for this type. */
  version: number;
  /** ISO 8601. */
  occurredAt: string;
  /** Shared by every request and event that follows from the same user action. */
  correlationId: string;
  /** Id of the event that caused this one; null when a request caused it. */
  causationId: string | null;
  payload: P;
}

export interface NewEvent<P = unknown> {
  type: string;
  version: number;
  payload: P;
}

/** Trace context of the work that publishes an event. */
export interface EventContext {
  correlationId: string;
  causationId?: string | null;
}

export function createEnvelope<P>(
  event: NewEvent<P>,
  context: EventContext,
  clock: Clock,
): EventEnvelope<P> {
  return {
    id: newId(),
    type: event.type,
    version: event.version,
    occurredAt: clock.now().toISOString(),
    correlationId: context.correlationId,
    causationId: context.causationId ?? null,
    payload: event.payload,
  };
}

/** Context for the events published while handling `cause`. */
export function causedBy(cause: EventEnvelope): EventContext {
  return { correlationId: cause.correlationId, causationId: cause.id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Structural check of a received message; payload schemas are checked per event type. */
export function isEnvelope(value: unknown): value is EventEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    UUID.test(e.id) &&
    typeof e.type === "string" &&
    e.type.length > 0 &&
    Number.isInteger(e.version) &&
    typeof e.occurredAt === "string" &&
    typeof e.correlationId === "string" &&
    (e.causationId === null || typeof e.causationId === "string") &&
    "payload" in e
  );
}
