import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isEnvelope } from "@lib/messaging";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "./test-database.js";

// supabase/migrations/20261014180000_notifier_and_worker.sql, applied after a database already holds
// legacy notifications and push tokens, as the hosted one does.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_notifier_and_worker.sql"),
)!;
const migrationSql = readFileSync(
  new URL(`../../../supabase/migrations/${MIGRATION}`, import.meta.url),
  "utf8",
);

let t: TestDatabase;
let db: Kysely<any>;

beforeAll(async () => {
  t = await startTestDatabase({ migrations: false });
  db = t.db;
  for (const file of trackedMigrations().filter((f) => f < MIGRATION)) {
    await sql
      .raw(
        readFileSync(
          new URL(`../../../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      )
      .execute(db);
  }
  await sql`
    insert into public.users (id, email) values ('user_a', 'a@example.com'), ('user_b', 'b@example.com');
    insert into public.notifications (id, "userId", title, message, type, is_read, created_at, data) values
      ('6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f', 'user_a', 'Read one', 'm1', 'system', true, '2026-05-01T00:00:00Z', '{"k":1}'),
      ('legacy-text-id', 'user_a', 'Unread', 'm2', null, false, '2026-05-02T00:00:00Z', '{}'),
      ('orphan', null, 'No recipient', 'm3', 'system', false, now(), '{}');
    insert into public.push_tokens (token, user_id, created_at) values
      ('ExponentPushToken[a]', 'user_b', '2026-01-01'),
      ('ExponentPushToken[a]', 'user_a', '2026-02-01'),
      ('ExponentPushToken[b]', null, now());
  `.execute(db);
  await sql.raw(migrationSql).execute(db);
}, 60_000);
afterAll(() => t?.close());

function as(role: string, query: string) {
  return t.asRole(role, (d) => sql.raw(query).execute(d));
}

describe("legacy data", () => {
  it("copies the notifications that have a recipient", async () => {
    const { rows } = await sql<any>`
      select id::text, user_id, type, title, body, data, read_at, created_at
      from notify.notifications order by created_at`.execute(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f",
      user_id: "user_a",
      type: "system",
      body: "m1",
      data: { k: 1 },
      read_at: new Date("2026-05-01T00:00:00Z"),
    });
    // A non-uuid legacy id gets a new one; a missing type becomes "system".
    expect(rows[1]).toMatchObject({
      type: "system",
      title: "Unread",
      read_at: null,
    });
    expect(rows[1].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps one owner per device: the latest", async () => {
    const { rows } =
      await sql`select token, user_id from notify.push_tokens`.execute(db);
    expect(rows).toEqual([
      { token: "ExponentPushToken[a]", user_id: "user_a" },
    ]);
  });
});

describe("rights", () => {
  it.each(["notifications", "push_tokens", "preferences", "deliveries"])(
    "svc_notifier alone uses notify.%s",
    async (table) => {
      await as("svc_notifier", `select * from notify.${table}`);
      for (const role of [
        "svc_gateway",
        "svc_worker",
        "anon",
        "authenticated",
      ]) {
        await expect(as(role, `select * from notify.${table}`)).rejects.toThrow(
          /permission denied/,
        );
      }
    },
  );

  it("svc_worker alone uses ops.job_runs", async () => {
    await as(
      "svc_worker",
      "insert into ops.job_runs (job, period_start) values ('x', now()); delete from ops.job_runs",
    );
    await expect(
      as("svc_notifier", "select * from ops.job_runs"),
    ).rejects.toThrow(/permission denied/);
  });

  it("gives the gateway profiles and trust links, and nothing else in public", async () => {
    await as(
      "svc_gateway",
      `insert into public.trusted (owner_id, trusted_id) values ('user_a', 'user_b');
       select * from public.users; delete from public.trusted;`,
    );
    for (const table of ["contracts", "notifications", "push_tokens"]) {
      await expect(
        as("svc_gateway", `select * from public.${table}`),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("keeps the public API keys out of the new tables and the tick", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(as(role, "select * from ops.job_runs")).rejects.toThrow(
        /permission denied/,
      );
      await expect(as(role, "select ops.send_tick()")).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("scheduler tick", () => {
  it("is scheduled every minute and puts a valid event in the worker's queue", async () => {
    const { rows: jobs } = await sql<{ schedule: string; command: string }>`
      select schedule, command from cron.job where jobname = 'worker-tick'`.execute(
      db,
    );
    expect(jobs).toEqual([
      { schedule: "* * * * *", command: "select ops.send_tick()" },
    ]);

    await sql.raw(jobs[0].command).execute(db);

    const { rows } = await sql<{ message: unknown }>`
      select message from pgmq.q_worker`.execute(db);
    expect(rows).toHaveLength(1);
    const tick = rows[0].message as Record<string, unknown>;
    expect(isEnvelope(tick)).toBe(true);
    expect(tick).toMatchObject({
      type: "scheduler.tick",
      version: 1,
      payload: {},
    });
    expect(new Date(tick.occurredAt as string).toISOString()).toBe(
      tick.occurredAt,
    );
  });
});

describe("routing", () => {
  it("sends each event of phase 2 to its consumers", async () => {
    const { rows } = await sql<{ event_type: string; queue: string }>`
      select event_type, queue from messaging.subscriptions order by 1, 2`.execute(
      db,
    );
    expect(rows.map((r) => `${r.event_type} → ${r.queue}`)).toEqual([
      "maintenance.push_receipts_due → notifier",
      "maintenance.retention_due → gateway",
      "maintenance.retention_due → notifier",
      "maintenance.retention_due → worker",
      "trust.added → notifier",
      "user.deleted → notifier",
    ]);
  });
});

describe("prerequisites", () => {
  it("stops with a clear message when pg_cron is not installed", async () => {
    const fresh = await startTestDatabase();
    try {
      await sql`drop schema cron cascade`.execute(fresh.db);
      await expect(sql.raw(migrationSql).execute(fresh.db)).rejects.toThrow(
        /pg_cron is missing/,
      );
    } finally {
      await fresh.close();
    }
  });
});
