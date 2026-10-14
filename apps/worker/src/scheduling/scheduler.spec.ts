import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { SchedulerService } from "./application/scheduler.service.js";
import { periodStart } from "./domain/schedule.js";
import { KyselySchedulerStores } from "./infrastructure/kysely-scheduler.stores.js";

let t: TestDatabase;
let db: Kysely<any>;
let clock: FakeClock;
let scheduler: SchedulerService;
const stores = new KyselySchedulerStores();
const cause = {
  id: "6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f",
  correlationId: "tick-1",
};

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`delete from ops.job_runs; delete from ops.outbox;`.execute(db);
  clock = new FakeClock(new Date("2026-10-14T10:07:00Z"));
  scheduler = new SchedulerService(clock);
});

/** One tick, handled as svc_worker in a transaction, like the consumer does. */
const tick = () =>
  t.asRole("svc_worker", (d) =>
    d.transaction().execute((tx) => scheduler.onTick(stores.bind(tx, cause))),
  );

const published = async () =>
  (
    await sql<{ type: string; envelope: any }>`
      select type, envelope from ops.outbox order by id`.execute(db)
  ).rows;

describe("period", () => {
  it("is aligned on the epoch", () => {
    expect(periodStart(new Date("2026-10-14T10:07:42Z"), 15 * 60_000)).toEqual(
      new Date("2026-10-14T10:00:00Z"),
    );
  });
});

describe("scheduler", () => {
  it("fires every job once on the first tick, caused by the tick", async () => {
    expect(await tick()).toEqual(["push-receipts", "retention"]);
    const events = await published();
    expect(events.map((e) => e.type)).toEqual([
      "maintenance.push_receipts_due",
      "maintenance.retention_due",
    ]);
    expect(events[0].envelope).toMatchObject({
      correlationId: "tick-1",
      causationId: cause.id,
      payload: {},
    });
  });

  it("fires a job once per period, however many ticks arrive", async () => {
    await tick();
    clock.advance(60_000);
    expect(await tick()).toEqual([]);
    clock.advance(8 * 60_000); // 10:16: next 15-minute period, same day
    expect(await tick()).toEqual(["push-receipts"]);
    expect(await tick()).toEqual([]);
  });

  it("fires a missed job at the next tick after the worker comes back", async () => {
    await tick();
    clock.advance(3 * 86_400_000);
    expect(await tick()).toEqual(["push-receipts", "retention"]);
  });

  it("publishes nothing if the tick's transaction fails", async () => {
    await expect(
      t.asRole("svc_worker", (d) =>
        d.transaction().execute(async (tx) => {
          await scheduler.onTick(stores.bind(tx, cause));
          throw new Error("commit failed");
        }),
      ),
    ).rejects.toThrow("commit failed");
    expect(await published()).toEqual([]);
    expect(await tick()).toEqual(["push-receipts", "retention"]);
  });

  it("forgets runs older than 30 days", async () => {
    await tick();
    clock.advance(31 * 86_400_000);
    const purged = await t.asRole("svc_worker", (d) =>
      scheduler.purge(stores.bind(d, cause)),
    );
    expect(purged).toBe(2);
  });
});
