import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "./test-database.js";

// supabase/migrations/20261109120000_notifier_language.sql, applied after people already chose their
// push settings, as on the hosted database.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_notifier_language.sql"),
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
    insert into notify.preferences (user_id, push_enabled) values ('user_a', false)
  `.execute(db);
  await sql.raw(migrationSql).execute(db);
}, 60_000);
afterAll(() => t?.close());

describe("notify.preferences.language", () => {
  it("leaves existing rows in French, with their push setting", async () => {
    const { rows } =
      await sql`select user_id, push_enabled, language from notify.preferences`.execute(
        db,
      );
    expect(rows).toEqual([
      { user_id: "user_a", push_enabled: false, language: "fr" },
    ]);
  });

  it("accepts the app's two languages only", async () => {
    await sql`update notify.preferences set language = 'en'`.execute(db);
    await expect(
      sql`update notify.preferences set language = 'de'`.execute(db),
    ).rejects.toThrow(/check constraint/);
  });

  it("can be applied twice", async () => {
    await expect(sql.raw(migrationSql).execute(db)).resolves.toBeDefined();
  });

  it("stays the notifier's alone", async () => {
    await t.asRole("svc_notifier", (d) =>
      sql`select language from notify.preferences`.execute(d),
    );
    await expect(
      t.asRole("svc_gateway", (d) =>
        sql`select language from notify.preferences`.execute(d),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
