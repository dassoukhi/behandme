import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "./test-database.js";

// supabase/migrations/20261112120000_notify_email.sql, applied after people already have accounts and
// settings, as on the hosted database.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_notify_email.sql"),
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
    insert into public.users (id, email, first_name, last_name) values
      ('user_a', 'a@mail.fr', 'Alice', 'Martin'),
      ('user_b', 'b@mail.fr', null, null);
    insert into notify.preferences (user_id, push_enabled, language) values ('user_a', false, 'en');
  `.execute(db);
  await sql.raw(migrationSql).execute(db);
}, 60_000);
afterAll(() => t?.close());

describe("notify.people", () => {
  it("starts with the address and name of every user", async () => {
    const { rows } =
      await sql`select user_id, email, first_name, last_name from notify.people order by user_id`.execute(
        db,
      );
    expect(rows).toEqual([
      {
        user_id: "user_a",
        email: "a@mail.fr",
        first_name: "Alice",
        last_name: "Martin",
      },
      {
        user_id: "user_b",
        email: "b@mail.fr",
        first_name: null,
        last_name: null,
      },
    ]);
  });

  it("is routed user.profile_changed", async () => {
    const { rows } =
      await sql`select queue from messaging.subscriptions where event_type = 'user.profile_changed'`.execute(
        db,
      );
    expect(rows).toEqual([{ queue: "notifier" }]);
  });
});

describe("notify.preferences", () => {
  it("e-mails and dates in Paris time until told otherwise, keeping the other settings", async () => {
    const { rows } =
      await sql`select push_enabled, email_enabled, language, time_zone from notify.preferences`.execute(
        db,
      );
    expect(rows).toEqual([
      {
        push_enabled: false,
        email_enabled: true,
        language: "en",
        time_zone: "Europe/Paris",
      },
    ]);
  });

  it("refuses an empty or overlong time zone", async () => {
    for (const zone of ["", "x".repeat(65)]) {
      await expect(
        sql`update notify.preferences set time_zone = ${zone}`.execute(db),
      ).rejects.toThrow(/check constraint/);
    }
  });
});

describe("notify.email_deliveries", () => {
  it("goes with its notification", async () => {
    await sql`
      insert into notify.notifications (id, user_id, type, title, body)
        values ('00000000-0000-4000-8000-000000000001', 'user_a', 'trust_added', 't', 'b');
      insert into notify.email_deliveries (notification_id, to_address, content)
        values ('00000000-0000-4000-8000-000000000001', 'a@mail.fr', '{}');
      delete from notify.notifications;
    `.execute(db);
    const { rows } = await sql`select 1 from notify.email_deliveries`.execute(
      db,
    );
    expect(rows).toEqual([]);
  });

  it("knows four states only", async () => {
    await sql`
      insert into notify.notifications (id, user_id, type, title, body)
        values ('00000000-0000-4000-8000-000000000002', 'user_a', 'trust_added', 't', 'b');
    `.execute(db);
    await expect(
      sql`insert into notify.email_deliveries (notification_id, to_address, content, status)
        values ('00000000-0000-4000-8000-000000000002', 'a@mail.fr', '{}', 'delivered')`.execute(
        db,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("the migration", () => {
  it("can be applied twice", async () => {
    await expect(sql.raw(migrationSql).execute(db)).resolves.toBeDefined();
  });

  it("leaves the addresses and e-mails to the notifier alone", async () => {
    await t.asRole("svc_notifier", (d) =>
      sql`select email from notify.people; select status from notify.email_deliveries`.execute(
        d,
      ),
    );
    for (const table of ["notify.people", "notify.email_deliveries"]) {
      await expect(
        t.asRole("svc_gateway", (d) =>
          sql.raw(`select 1 from ${table}`).execute(d),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
