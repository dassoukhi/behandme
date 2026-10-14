import type { Logger } from "@lib/kernel";
import {
  type EventHandler,
  type Executor,
  OutboxRelay,
  PgmqBus,
  QueueConsumer,
} from "@lib/messaging";
import { PollingLoop } from "./polling-loop.js";

export interface MessagingRuntimeOptions {
  db: Executor;
  /** The service's schema: its outbox and processed_messages. */
  schema: string;
  /** The service's queue. */
  queue: string;
  handlers: Record<string, EventHandler>;
  logger: Logger;
  /** Drain the service's outbox to the subscribers' queues (false if it publishes nothing). */
  relay?: boolean;
  idleMs?: number;
}

/**
 * The background loops of a service: the outbox relay and the consumer of its queue. Several
 * instances can run at once (rows are locked with SKIP LOCKED, messages hidden while handled).
 */
export class MessagingRuntime {
  private readonly loops: PollingLoop[] = [];

  constructor(options: MessagingRuntimeOptions) {
    const { db, schema, queue, handlers, logger, idleMs } = options;
    const bus = new PgmqBus();
    if (options.relay !== false) {
      const relay = new OutboxRelay(db, { schema, bus, logger });
      this.loops.push(
        new PollingLoop({
          name: `${schema} outbox relay`,
          run: () => relay.relayOnce(),
          logger,
          idleMs,
        }),
      );
    }
    const consumer = new QueueConsumer(db, {
      queue,
      schema,
      bus,
      handlers,
      logger,
    });
    this.loops.push(
      new PollingLoop({
        name: `${queue} queue consumer`,
        run: async () => {
          const r = await consumer.pollOnce();
          return r.handled + r.duplicates + r.failed + r.deadLettered;
        },
        logger,
        idleMs,
      }),
    );
  }

  start(): void {
    for (const loop of this.loops) loop.start();
  }

  async stop(): Promise<void> {
    await Promise.all(this.loops.map((loop) => loop.stop()));
  }
}
