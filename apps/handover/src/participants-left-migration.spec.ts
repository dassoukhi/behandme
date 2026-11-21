import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "@lib/testing";

// supabase/migrations/20261121120000_participants_left.sql, applied after contracts already have participants, as
// on the hosted database.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_participants_left.sql"),
)!;
const read = (file: string) =>
  readFileSync(
    new URL(`../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
const CONTRACT = "6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f";

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
      `insert into handover.contracts (id, owner_id, category) values ('${CONTRACT}', 'user_o', 'networks');
      insert into handover.participants (contract_id, user_id, role, position) values
        ('${CONTRACT}', 'user_a', 'accessor', 0), ('${CONTRACT}', 'user_v', 'validator', 0);`,
    )
    .execute(db);
  await sql.raw(read(MIGRATION)).execute(db);
}, 60_000);
afterAll(() => t?.close());

const asHandover = (query: string) =>
  t.asRole("svc_handover", (d) => sql.raw(query).execute(d));

describe("handover.participants.left_at and left_reason", () => {
  it("leaves every existing participant present", async () => {
    const { rows } = await sql`
      select user_id, left_at, left_reason from handover.participants order by user_id
    `.execute(db);
    expect(rows).toEqual([
      { user_id: "user_a", left_at: null, left_reason: null },
      { user_id: "user_v", left_at: null, left_reason: null },
    ]);
  });

  it("lets handover record a departure with its time and its reason: both or neither", async () => {
    await asHandover(
      `update handover.participants set left_at = now(), left_reason = 'declined' where user_id = 'user_v'`,
    );
    await expect(
      asHandover(
        `update handover.participants set left_reason = 'declined' where user_id = 'user_a'`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asHandover(
        `update handover.participants set left_at = now() where user_id = 'user_a'`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asHandover(
        `update handover.participants set left_at = now(), left_reason = 'bored' where user_id = 'user_a'`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("can be applied twice", async () => {
    await expect(sql.raw(read(MIGRATION)).execute(db)).resolves.toBeDefined();
  });

  it("stays handover's alone", async () => {
    await expect(
      t.asRole("svc_gateway", (d) =>
        sql`select left_at from handover.participants`.execute(d),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
