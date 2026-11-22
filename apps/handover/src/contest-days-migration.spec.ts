import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "@lib/testing";

// supabase/migrations/20261122160000_contest_days_up_to_90.sql, applied after envelopes exist, as on the hosted
// database.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_contest_days_up_to_90.sql"),
)!;
const read = (file: string) =>
  readFileSync(
    new URL(`../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );

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
      `insert into handover.contracts (owner_id, category, contest_days) values ('user_o', 'networks', 30);`,
    )
    .execute(db);
  await sql.raw(read(MIGRATION)).execute(db);
}, 60_000);
afterAll(() => t?.close());

const insert = (days: number) =>
  t.asRole("svc_handover", (d) =>
    sql`insert into handover.contracts (owner_id, category, contest_days) values ('user_o', 'devices', ${days})`.execute(
      d,
    ),
  );

describe("handover.contracts.contest_days", () => {
  it("keeps the existing envelopes as they were", async () => {
    const { rows } =
      await sql`select contest_days from handover.contracts`.execute(db);
    expect(rows).toEqual([{ contest_days: 30 }]);
  });

  it("accepts 3 days to 3 months, nothing outside", async () => {
    await insert(3);
    await insert(90);
    await expect(insert(91)).rejects.toThrow(/check constraint/);
    await expect(insert(2)).rejects.toThrow(/check constraint/);
  });

  it("still keeps finances to 15 days or more", async () => {
    await expect(
      t.asRole("svc_handover", (d) =>
        sql`insert into handover.contracts (owner_id, category, contest_days) values ('user_o', 'finances', 7)`.execute(
          d,
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("can be applied twice", async () => {
    await expect(sql.raw(read(MIGRATION)).execute(db)).resolves.toBeDefined();
  });
});
