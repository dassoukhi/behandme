import { type Kysely, sql } from "kysely";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { currentCorrelationId } from "@lib/kernel";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { createEnvelope, type EventEnvelope } from "./envelope.js";
import { QueueConsumer, type EventHandler } from "./consumer.js";
import { MalformedMessageError } from "./errors.js";
import { purgeMessagingTables } from "./retention.js";
import { TransactionalOutbox } from "./outbox.js";
import { PgmqBus } from "./pgmq-bus.js";
import { OutboxRelay } from "./relay.js";

// The gateway publishes from schema core; the notifier consumes queue "notifier" into schema notify.
const bus = new PgmqBus();
const clock = new FakeClock();
let t: TestDatabase;
const spyLogger = () => ({
  log: vi.fn<(message: string) => void>(),
  warn: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
});
let logger: ReturnType<typeof spyLogger>;

const trustAdded = {
  type: "trust.added",
  version: 1,
  payload: { ownerId: "user_a", trustedId: "user_b" },
};

function publish(db: Kysely<any>, deliverAt?: Date) {
  return db.transaction().execute((tx) =>
    new TransactionalOutbox(tx, {
      schema: "core",
      context: { correlationId: "corr-1" },
      clock,
    }).publish(trustAdded, { deliverAt }),
  );
}

function relay() {
  return t.asRole("svc_gateway", (db) =>
    new OutboxRelay(db, { schema: "core", bus, logger }).relayOnce(),
  );
}

function consumer(handlers: Record<string, EventHandler>, maxAttempts = 3) {
  return new QueueConsumer(t.db, {
    queue: "notifier",
    schema: "notify",
    bus,
    handlers,
    logger,
    maxAttempts,
    visibilitySeconds: 0, // a failed message is visible again at once
  });
}

function poll(c: QueueConsumer) {
  return t.asRole("svc_notifier", () => c.pollOnce());
}

/** A handler that records each call in a table of the notifier's schema, inside its transaction. */
const recordEffect: EventHandler = async (event, tx) => {
  await sql`insert into notify.effects (event_id) values (${event.id}::uuid)`.execute(
    tx,
  );
};

async function count(table: string): Promise<number> {
  const { rows } = await sql<{
    n: string;
  }>`select count(*) as n from ${sql.raw(table)}`.execute(t.db);
  return Number(rows[0].n);
}

beforeAll(async () => {
  t = await startTestDatabase();
  // Created after the migration: the default privileges must give the notifier access to it.
  await sql`create table notify.effects (event_id uuid not null)`.execute(t.db);
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  logger = spyLogger();
  await sql`
    delete from core.outbox;
    delete from notify.processed_messages;
    delete from notify.effects;
    delete from messaging.subscriptions;
    delete from pgmq.q_notifier; delete from pgmq.a_notifier;
    delete from pgmq.q_worker;
    insert into messaging.subscriptions (event_type, queue) values
      ('trust.added', 'notifier'), ('trust.added', 'worker');
  `.execute(t.db);
});

describe("transactional outbox", () => {
  it("keeps an event only when the transaction that publishes it commits", async () => {
    await t.asRole("svc_gateway", (db) => publish(db));
    await expect(
      t.asRole("svc_gateway", (db) =>
        db.transaction().execute(async (tx) => {
          await new TransactionalOutbox(tx, {
            schema: "core",
            context: { correlationId: "c" },
            clock,
          }).publish(trustAdded);
          throw new Error("state change failed");
        }),
      ),
    ).rejects.toThrow("state change failed");

    expect(await count("core.outbox")).toBe(1);
  });
});

describe("outbox relay", () => {
  it("delivers each event once to every subscribed queue and marks it sent", async () => {
    const event = await t.asRole("svc_gateway", (db) => publish(db));

    expect(await relay()).toBe(1);
    expect(await relay()).toBe(0);

    const { rows } = await sql<{ message: EventEnvelope }>`
      select message from pgmq.q_notifier union all select message from pgmq.q_worker`.execute(
      t.db,
    );
    expect(rows.map((r) => r.message)).toEqual([event, event]);
    const pending =
      await sql`select 1 from core.outbox where sent_at is null`.execute(t.db);
    expect(pending.rows).toHaveLength(0);
  });

  it("marks an event without subscriber as sent and says so", async () => {
    await sql`delete from messaging.subscriptions`.execute(t.db);
    await t.asRole("svc_gateway", (db) => publish(db));

    expect(await relay()).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("No subscriber for trust.added"),
    );
    expect(await count("pgmq.q_notifier")).toBe(0);
  });

  it("holds a delayed event back until it is due", async () => {
    await t.asRole("svc_gateway", (db) =>
      publish(db, new Date(Date.now() + 120_000)),
    );
    await relay();

    expect(await count("pgmq.q_notifier")).toBe(1);
    const result = await poll(consumer({ "trust.added": recordEffect }));
    expect(result.handled).toBe(0);
    const { rows } = await sql<{ due: boolean }>`
      select vt > now() + interval '100 seconds' as due from pgmq.q_notifier`.execute(
      t.db,
    );
    expect(rows[0].due).toBe(true);
  });
});

describe("queue consumer", () => {
  it("runs the handler once when the same event arrives twice", async () => {
    const event = createEnvelope(trustAdded, { correlationId: "c" }, clock);
    await bus.send(t.db, "notifier", event);
    await bus.send(t.db, "notifier", event);

    const result = await poll(consumer({ "trust.added": recordEffect }));

    expect(result).toEqual({
      handled: 1,
      duplicates: 1,
      failed: 0,
      deadLettered: 0,
    });
    expect(await count("notify.effects")).toBe(1);
    expect(await count("pgmq.q_notifier")).toBe(0);
  });

  it("retries a failing handler, rolls back its writes, then dead-letters the message", async () => {
    const failing: EventHandler = async (event, tx) => {
      await recordEffect(event, tx);
      throw new Error("push provider down");
    };
    await bus.send(
      t.db,
      "notifier",
      createEnvelope(trustAdded, { correlationId: "c" }, clock),
    );
    const c = consumer({ "trust.added": failing }, 2);

    expect((await poll(c)).failed).toBe(1);
    expect((await poll(c)).failed).toBe(1);
    expect((await poll(c)).deadLettered).toBe(1);

    expect(await count("notify.effects")).toBe(0);
    expect(await count("notify.processed_messages")).toBe(0);
    expect(await count("pgmq.q_notifier")).toBe(0);
    expect(await count("pgmq.a_notifier")).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("attempt 2/2"),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("failed 2 times"),
    );
  });

  it("dead-letters a message that is not an envelope or has no handler of its own", async () => {
    await bus.send(t.db, "notifier", {
      hello: "world",
    } as unknown as EventEnvelope);
    await bus.send(
      t.db,
      "notifier",
      createEnvelope(
        { type: "contract.sealed", version: 1, payload: {} },
        { correlationId: "c" },
        clock,
      ),
    );
    // A type named like an Object.prototype member is not a handler either.
    await bus.send(
      t.db,
      "notifier",
      createEnvelope(
        { type: "constructor", version: 1, payload: {} },
        { correlationId: "c" },
        clock,
      ),
    );

    const result = await poll(consumer({ "trust.added": recordEffect }));

    expect(result.deadLettered).toBe(3);
    expect(await count("pgmq.a_notifier")).toBe(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("is not an event envelope"),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("has no handler for contract.sealed"),
    );
  });

  it("dead-letters a malformed payload at once, without retrying", async () => {
    await bus.send(
      t.db,
      "notifier",
      createEnvelope(trustAdded, { correlationId: "c" }, clock),
    );
    const result = await poll(
      consumer({
        "trust.added": async () => {
          throw new MalformedMessageError("ownerName is missing");
        },
      }),
    );

    expect(result).toMatchObject({ failed: 0, deadLettered: 1 });
    expect(await count("pgmq.a_notifier")).toBe(1);
    expect(await count("notify.processed_messages")).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("malformed trust.added"),
    );
  });

  it("runs the handler with the event's correlation id", async () => {
    await bus.send(
      t.db,
      "notifier",
      createEnvelope(trustAdded, { correlationId: "corr-42" }, clock),
    );
    let seen: string | undefined;
    await poll(
      consumer({
        "trust.added": async () => {
          seen = currentCorrelationId();
        },
      }),
    );

    expect(seen).toBe("corr-42");
    expect(currentCorrelationId()).toBeUndefined();
  });

  it("delivers end to end: publish, relay, consume", async () => {
    const event = await t.asRole("svc_gateway", (db) => publish(db));
    await relay();

    const seen: EventEnvelope[] = [];
    const result = await poll(
      consumer({
        "trust.added": async (e, tx) => {
          seen.push(e);
          await recordEffect(e, tx);
        },
      }),
    );

    expect(result.handled).toBe(1);
    expect(seen).toEqual([event]);
  });
});

describe("retention", () => {
  it("forgets relayed events and processed ids once they are old enough", async () => {
    const now = new Date("2026-03-01T00:00:00Z");
    await sql`
      insert into core.outbox (event_id, type, envelope, sent_at) values
        (gen_random_uuid(), 'old', '{}', '2026-02-20T00:00:00Z'),
        (gen_random_uuid(), 'recent', '{}', '2026-02-25T00:00:00Z'),
        (gen_random_uuid(), 'pending', '{}', null);
      insert into core.processed_messages (consumer, event_id, processed_at) values
        ('gateway', gen_random_uuid(), '2026-01-15T00:00:00Z'),
        ('gateway', gen_random_uuid(), '2026-02-15T00:00:00Z');
    `.execute(t.db);

    const purged = await t.asRole("svc_gateway", (db) =>
      purgeMessagingTables(db, "core", now),
    );

    expect(purged).toEqual({ outbox: 1, processed: 1 });
    const { rows } = await sql<{
      type: string;
    }>`select type from core.outbox order by type`.execute(t.db);
    expect(rows.map((r) => r.type)).toEqual(["pending", "recent"]);
    await sql`delete from core.processed_messages`.execute(t.db);
  });
});
