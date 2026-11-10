import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./test-database.js";

// supabase/scripts/20261111_reset_for_behyndme_labels.sql, run as on the hosted database (as postgres) over
// data of every kind it deletes or keeps.
const SCRIPT = readFileSync(
  new URL(
    "../../../supabase/scripts/20261111_reset_for_behyndme_labels.sql",
    import.meta.url,
  ),
  "utf8",
);
const CONTRACT = "5d2f7a10-8c3e-4b6a-9f21-0a1b2c3d4e5f";

let t: TestDatabase;
let db: Kysely<any>;

const count = async (table: string) =>
  Number(
    (
      await sql<{
        n: string;
      }>`select count(*) as n from ${sql.raw(table)}`.execute(db)
    ).rows[0].n,
  );
const appendEvent = () =>
  sql`select handover.append_event(${CONTRACT}::uuid, 'contract.created', 'user_a', '{}')`.execute(
    db,
  );

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
  await sql`insert into public.users (id, email) values ('user_a', 'a@x.fr'), ('user_b', 'b@x.fr')`.execute(
    db,
  );
  await sql`insert into public.trusted (owner_id, trusted_id) values ('user_a', 'user_b')`.execute(
    db,
  );
  await sql`insert into core.user_keys (user_id, key_version, kem_public_key, signing_public_key, fingerprint, signature, usable_from)
    values ('user_a', 1, ${new Uint8Array(1216)}, ${new Uint8Array(32)}, ${"a".repeat(64)}, ${new Uint8Array(64)}, now())`.execute(
    db,
  );
  await sql`insert into core.key_transfers (user_id, recipient_key, key_version, expires_at)
    values ('user_a', ${new Uint8Array(1216)}, 1, now())`.execute(db);
  await sql`insert into handover.contracts (id, owner_id, category) values (${CONTRACT}, 'user_a', 'devices')`.execute(
    db,
  );
  await sql`insert into handover.participants (contract_id, user_id, role, position)
    values (${CONTRACT}, 'user_b', 'accessor', 0)`.execute(db);
  await appendEvent();
  await sql`insert into notify.notifications (user_id, type, title, body) values ('user_a', 'claim_filed', 'T', 'B')`.execute(
    db,
  );
  await sql`insert into notify.preferences (user_id, push_enabled) values ('user_a', true)`.execute(
    db,
  );
  for (const queue of ["handover", "notifier", "gateway"]) {
    await sql`select pgmq.send(${queue}, '{}'::jsonb)`.execute(db);
  }
  await sql.raw(SCRIPT).execute(db);
}, 60_000);
afterAll(() => t?.close());

describe("the reset for the behyndme labels", () => {
  it("deletes the keys, the contracts and their audit log, the notifications and the events about them", async () => {
    for (const table of [
      "core.user_keys",
      "core.key_transfers",
      "handover.contracts",
      "handover.participants",
      "handover.contract_events",
      "notify.notifications",
      "pgmq.q_handover",
      "pgmq.q_notifier",
    ]) {
      expect(await count(table), table).toBe(0);
    }
  });

  it("keeps the accounts, their trust links and settings, the event routes and the maintenance queues", async () => {
    expect(await count("public.users")).toBe(2);
    expect(await count("public.trusted")).toBe(1);
    expect(await count("notify.preferences")).toBe(1);
    expect(await count("pgmq.q_gateway")).toBe(1);
    expect(await count("messaging.subscriptions")).toBeGreaterThan(0);
  });

  it("backs up every row it deletes, out of the API's reach", async () => {
    for (const table of [
      "user_keys",
      "key_transfers",
      "contracts",
      "participants",
      "contract_events",
      "notifications",
      "q_handover",
      "q_notifier",
    ]) {
      expect(await count(`backup_20261111.${table}`), table).toBe(1);
    }
    const { rows } = await sql<{
      usable: boolean;
    }>`select has_schema_privilege('anon', 'backup_20261111', 'usage') as usable`.execute(
      db,
    );
    expect(rows[0].usable).toBe(false);
  });

  it("leaves the audit log append-only again", async () => {
    await appendEvent();
    await expect(
      sql`delete from handover.contract_events`.execute(db),
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`truncate handover.contract_events`.execute(db),
    ).rejects.toThrow(/append-only/);
  });
});
