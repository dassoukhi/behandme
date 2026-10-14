import type { z } from "zod";
import {
  type EventEnvelope,
  type EventHandler,
  type Executor,
  MalformedMessageError,
  type NewEvent,
} from "@lib/messaging";

/** A versioned event type and the schema of its payload, shared by publishers and consumers. */
export interface EventDefinition<S extends z.ZodType> {
  type: string;
  version: number;
  schema: S;
  /** The event to publish; throws if the payload breaks the schema. */
  create(payload: z.input<S>): NewEvent<z.output<S>>;
  /** Payload of a received event; throws MalformedMessageError if it is not this event. */
  parse(event: EventEnvelope): z.output<S>;
}

export function defineEvent<S extends z.ZodType>(
  type: string,
  version: number,
  schema: S,
): EventDefinition<S> {
  return {
    type,
    version,
    schema,
    create: (payload) => ({ type, version, payload: schema.parse(payload) }),
    parse(event) {
      if (event.type !== type || event.version !== version) {
        throw new MalformedMessageError(
          `expected ${type} v${version}, got ${event.type} v${event.version}`,
        );
      }
      const parsed = schema.safeParse(event.payload);
      if (!parsed.success) {
        throw new MalformedMessageError(parsed.error.message);
      }
      return parsed.data;
    },
  };
}

/** Handler entry for a consumer: checks the payload before `handle` sees it. */
export function on<S extends z.ZodType>(
  definition: EventDefinition<S>,
  handle: (
    payload: z.output<S>,
    event: EventEnvelope,
    tx: Executor,
  ) => Promise<void>,
): [string, EventHandler] {
  return [
    definition.type,
    (event, tx) => handle(definition.parse(event), event, tx),
  ];
}
