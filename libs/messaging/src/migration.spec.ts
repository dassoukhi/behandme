import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "@lib/testing";

// Rights granted by supabase/migrations/20261013230000_service_schemas_and_messaging.sql.
const SERVICES = [
  { role: "svc_gateway", schema: "core", queue: "gateway" },
  { role: "svc_handover", schema: "handover", queue: "handover" },
  { role: "svc_notifier", schema: "notify", queue: "notifier" },
  { role: "svc_worker", schema: "ops", queue: "worker" },
];
const envelope = JSON.stringify({ hello: "queue" });

let t: TestDatabase;
beforeAll(async () => {
  t = await startTestDatabase();
}, 60_000);
afterAll(() => t?.close());

function as(role: string, query: string) {
  return t.asRole(role, (db) => sql.raw(query).execute(db));
}

describe("service schemas", () => {
  it.each(SERVICES)(
    "$role reads and writes its own outbox",
    async ({ role, schema }) => {
      await as(
        role,
        `insert into ${schema}.outbox (event_id, type, envelope) values (gen_random_uuid(), 'x', '{}');
       select * from ${schema}.outbox; delete from ${schema}.outbox;`,
      );
    },
  );

  it.each(SERVICES)(
    "$role cannot touch another service's schema",
    async ({ role, schema }) => {
      for (const other of SERVICES.filter((s) => s.schema !== schema)) {
        await expect(
          as(role, `select * from ${other.schema}.outbox`),
        ).rejects.toThrow(/permission denied/);
      }
    },
  );

  it("gives tables added later to a schema to its service only", async () => {
    await sql`create table handover.later (id int)`.execute(t.db);
    await as(
      "svc_handover",
      "insert into handover.later values (1); select * from handover.later",
    );
    await expect(
      as("svc_notifier", "select * from handover.later"),
    ).rejects.toThrow(/permission denied/);
  });

  it("enables row level security on every table it creates", async () => {
    const { rows } = await sql<{ table: string }>`
      select n.nspname || '.' || c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and not c.relrowsecurity
        and (n.nspname in ('messaging', 'core', 'handover', 'notify', 'ops')
             or (n.nspname = 'pgmq' and c.relname ~ '^[qa]_(gateway|handover|notifier|worker)$'))
        and c.relname <> 'later'`.execute(t.db);
    expect(rows).toEqual([]);
  });
});

describe("queues", () => {
  it.each(SERVICES)(
    "$role sends to every queue and reads only its own",
    async ({ role, queue }) => {
      for (const target of SERVICES) {
        await as(
          role,
          `select messaging.send('${target.queue}', '${envelope}'::jsonb)`,
        );
      }
      await as(
        role,
        `select msg_id from pgmq.read('${queue}', 0, 10);
       select pgmq.archive('${queue}', (select max(msg_id) from pgmq.q_${queue}));
       select pgmq.delete('${queue}', (select max(msg_id) from pgmq.q_${queue}));`,
      );
      for (const other of SERVICES.filter((s) => s.queue !== queue)) {
        await expect(
          as(role, `select * from pgmq.read('${other.queue}', 0, 10)`),
        ).rejects.toThrow(/permission denied/);
        await expect(
          as(role, `select * from pgmq.q_${other.queue}`),
        ).rejects.toThrow(/permission denied/);
      }
    },
  );

  it("lets every service read the routing table but not change it", async () => {
    for (const { role } of SERVICES) {
      await as(role, "select * from messaging.subscriptions");
      await expect(
        as(role, "insert into messaging.subscriptions values ('x', 'gateway')"),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("public API keys", () => {
  it.each(["anon", "authenticated"])(
    "%s reaches none of the service schemas or queues",
    async (role) => {
      for (const schema of ["messaging", "core", "handover", "notify", "ops"]) {
        const table = schema === "messaging" ? "subscriptions" : "outbox";
        await expect(
          as(role, `select * from ${schema}.${table}`),
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        as(role, `select messaging.send('gateway', '${envelope}'::jsonb)`),
      ).rejects.toThrow(/permission denied/);
      await expect(as(role, "select * from pgmq.q_gateway")).rejects.toThrow(
        /permission denied/,
      );
    },
  );
});

describe("prerequisites", () => {
  const migration = readFileSync(
    new URL(
      `../../../supabase/migrations/${trackedMigrations().find((file) =>
        file.endsWith("_service_schemas_and_messaging.sql"),
      )}`,
      import.meta.url,
    ),
    "utf8",
  );

  it("stops with a clear message when pgmq is not installed", async () => {
    const bare = await PGlite.create();
    try {
      await expect(bare.exec(migration)).rejects.toThrow(/pgmq is missing/);
    } finally {
      await bare.close();
    }
  });

  // On Supabase a GRANT the migration role may not give only warns: the migration must notice.
  it("applies nothing when a right was not actually granted", async () => {
    const withoutPgmqUsage = migration.replace(
      "grant usage on schema pgmq to svc_gateway, svc_handover, svc_notifier, svc_worker;",
      "",
    );
    expect(withoutPgmqUsage).not.toBe(migration);
    const fresh = await startTestDatabase({ migrations: false });
    try {
      await expect(sql.raw(withoutPgmqUsage).execute(fresh.db)).rejects.toThrow(
        /nothing was applied: svc_gateway lacks USAGE on pgmq/,
      );
      await sql`rollback`.execute(fresh.db);
      const { rows } = await sql`
        select nspname from pg_namespace where nspname in ('messaging', 'core')`.execute(
        fresh.db,
      );
      expect(rows).toEqual([]);
    } finally {
      await fresh.close();
    }
  });
});
