import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "@lib/testing";

// supabase/migrations/20261122120000_transmission_rules.sql, applied after envelopes and claims exist, as on the hosted
// database.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_transmission_rules.sql"),
)!;
const read = (file: string) =>
  readFileSync(
    new URL(`../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
const OLD = "6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f";

let t: TestDatabase;
let db: Kysely<any>;

beforeAll(async () => {
  t = await startTestDatabase({ migrations: false });
  db = t.db;
  for (const file of trackedMigrations().filter((f) => f < MIGRATION)) {
    await sql.raw(read(file)).execute(db);
  }
  await sql
    .raw(
      `insert into handover.contracts (id, owner_id, category, status, sealed_version)
        values ('${OLD}', 'user_o', 'networks', 'claimed', 1);
      insert into handover.claims (contract_id, claimant_id, sealed_version, contest_until, expires_at)
        values ('${OLD}', 'user_a', 1, now(), now());`,
    )
    .execute(db);
  await sql.raw(read(MIGRATION)).execute(db);
}, 60_000);
afterAll(() => t?.close());

const asHandover = (query: string) =>
  t.asRole("svc_handover", (d) => sql.raw(query).execute(d));
const insertContract = (values: string) =>
  asHandover(
    `insert into handover.contracts (owner_id, category, contest_days, incapacity_allowed) values (${values})`,
  );

describe("transmission rules", () => {
  it("keeps the existing envelopes as they were, handed over after a death only, and their claims without a reason", async () => {
    const { rows } = await sql`
      select c.contest_days, c.incapacity_allowed, k.reason
      from handover.contracts c join handover.claims k on k.contract_id = c.id
    `.execute(db);
    expect(rows).toEqual([
      { contest_days: 7, incapacity_allowed: false, reason: null },
    ]);
  });

  it("gives a new envelope 15 days to cancel a claim", async () => {
    const { rows } = await t.asRole("svc_handover", (d) =>
      sql<{
        contest_days: number;
      }>`insert into handover.contracts (owner_id, category) values ('user_o', 'devices') returning contest_days`.execute(
        d,
      ),
    );
    expect(rows).toEqual([{ contest_days: 15 }]);
  });

  it("accepts a finances envelope only with 15 days or more and no claim for an incapacity", async () => {
    await insertContract(`'user_o', 'finances', 15, false`);
    await expect(
      insertContract(`'user_o', 'finances', 7, false`),
    ).rejects.toThrow(/check constraint/);
    await expect(
      insertContract(`'user_o', 'finances', 30, true`),
    ).rejects.toThrow(/check constraint/);
    await insertContract(`'user_o', 'storage', 3, true`);
    await expect(insertContract(`'user_o', 'bank', 15, false`)).rejects.toThrow(
      /check constraint/,
    );
  });

  it("records a claim's reason: a death or an incapacity", async () => {
    await asHandover(`update handover.claims set reason = 'incapacity'`);
    await expect(
      asHandover(`update handover.claims set reason = 'absence'`),
    ).rejects.toThrow(/check constraint/);
  });

  it("routes the change of these rules to the notifier", async () => {
    const { rows } = await sql`
      select queue from messaging.subscriptions where event_type = 'contract.rules_changed'
    `.execute(db);
    expect(rows).toEqual([{ queue: "notifier" }]);
  });

  it("can be applied twice", async () => {
    await expect(sql.raw(read(MIGRATION)).execute(db)).resolves.toBeDefined();
  });

  it("stays handover's alone", async () => {
    await expect(
      t.asRole("svc_gateway", (d) =>
        sql`select incapacity_allowed from handover.contracts`.execute(d),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
