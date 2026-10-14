import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "@lib/testing";
import type { ChainEvent } from "./contracts/domain/audit-chain.js";
import { verifyChain } from "./contracts/domain/audit-chain.js";
import { nodeSha256 } from "./contracts/infrastructure/sha256.js";

// supabase/migrations/20261014220000_handover_and_audit_log.sql, applied after a database that
// already holds legacy contracts.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_handover_and_audit_log.sql"),
)!;
const read = (file: string) =>
  readFileSync(
    new URL(`../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );

const LEGACY = "6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f";
const ORPHAN = "7f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f";
const SECOND = "8f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f";

let t: TestDatabase;
let db: Kysely<any>;

beforeAll(async () => {
  t = await startTestDatabase({ migrations: false });
  db = t.db;
  for (const file of trackedMigrations().filter((f) => f < MIGRATION)) {
    await sql.raw(read(file)).execute(db);
  }
  // Fixed ids, no parameters: one multi-statement script.
  await sql
    .raw(
      `insert into public.users (id, email) values
        ('user_o', 'o@x.fr'), ('user_a', 'a@x.fr'), ('user_v', 'v@x.fr'), ('user_w', 'w@x.fr');
      insert into public.contracts (id, owner_id, name, description, accessor_id, validators, status, secret_hash) values
        ('${LEGACY}', 'user_o', 'devices', 'Téléphone', 'user_a',
         array['user_w', 'user_o', 'user_w'], 'active', 'h');
      insert into public.contracts (id, owner_id, name, accessor_id, validators) values
        ('${SECOND}', 'user_v', 'storage', 'user_a', array['user_a', 'user_w']);
      insert into public.contracts (id, owner_id, name, accessor_id, validators) values
        ('${ORPHAN}', null, 'networks', 'user_a', array['user_v']);`,
    )
    .execute(db);
  await sql.raw(read(MIGRATION)).execute(db);
}, 60_000);
afterAll(() => t?.close());

const as = (role: string, query: string) =>
  t.asRole(role, (d) => sql.raw(query).execute(d));

describe("legacy contracts", () => {
  it("become drafts, without their secret, with distinct participants other than the owner", async () => {
    const { rows } = await sql<any>`
      select id::text, owner_id, category, description, status, version
      from handover.contracts order by owner_id`.execute(db);
    expect(rows).toEqual([
      {
        id: LEGACY,
        owner_id: "user_o",
        category: "devices",
        description: "Téléphone",
        status: "draft",
        version: 1,
      },
      {
        id: SECOND,
        owner_id: "user_v",
        category: "storage",
        description: null,
        status: "draft",
        version: 1,
      },
    ]);
    const { rows: participants } = await sql<any>`
      select contract_id::text as contract, user_id, role
      from handover.participants order by contract_id, role, position`.execute(
      db,
    );
    // The owner and duplicates leave the validators; so does the accessor.
    expect(participants).toEqual([
      { contract: LEGACY, user_id: "user_a", role: "accessor" },
      { contract: LEGACY, user_id: "user_w", role: "validator" },
      { contract: SECOND, user_id: "user_a", role: "accessor" },
      { contract: SECOND, user_id: "user_w", role: "validator" },
    ]);
  });

  it("start a chain that verifies", async () => {
    const { rows } = await sql<ChainEvent>`
      select contract_id::text, seq, type, actor_id, body, occurred_at, prev_hash, hash
      from handover.contract_events where contract_id = ${LEGACY}::uuid order by seq`.execute(
      db,
    );
    expect(rows.map((e) => [e.type, e.actor_id, e.body])).toEqual([
      ["contract.imported", null, "{}"],
    ]);
    expect(verifyChain(LEGACY, rows, nodeSha256).ok).toBe(true);
  });
});

describe("audit log", () => {
  it("cannot be changed, removed or emptied, even by the table owner", async () => {
    await expect(
      sql`update handover.contract_events set body = '{}'`.execute(db),
    ).rejects.toThrow(/append-only \(UPDATE refused\)/);
    await expect(
      sql`delete from handover.contract_events`.execute(db),
    ).rejects.toThrow(/append-only \(DELETE refused\)/);
    await expect(
      sql`truncate handover.contract_events`.execute(db),
    ).rejects.toThrow(/append-only \(TRUNCATE refused\)/);
  });

  it("is written by svc_handover through append_event only", async () => {
    await as(
      "svc_handover",
      `select handover.append_event('${LEGACY}', 'contract.updated', 'user_o', '{"fields":["description"]}');
       select * from handover.contract_events;`,
    );
    await expect(
      as(
        "svc_handover",
        `insert into handover.contract_events (contract_id, seq, type, body, occurred_at, prev_hash, hash)
         values ('${LEGACY}', 99, 'x.y', '{}', '2026-01-01T00:00:00.000Z', repeat('0', 64), repeat('1', 64))`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    "svc_gateway",
    "svc_notifier",
    "svc_worker",
    "anon",
    "authenticated",
  ])("is out of reach of %s", async (role) => {
    await expect(
      as(role, "select * from handover.contract_events"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(role, `select handover.append_event('${LEGACY}', 'x.y', null, '{}')`),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["a malformed type", "Contract Created", "user_o", "{}"],
    ["an actor with a space", "contract.updated", "user o", "{}"],
    ["a body that is not JSON", "contract.updated", "user_o", "not json"],
  ])("refuses %s", async (_case, type, actor, body) => {
    await expect(
      sql`select handover.append_event(${LEGACY}::uuid, ${type}, ${actor}, ${body})`.execute(
        db,
      ),
    ).rejects.toThrow();
  });

  it("chains each event to the previous one, with the format the verifiers use", async () => {
    const { rows } = await sql<ChainEvent>`
      select contract_id::text, seq, type, actor_id, body, occurred_at, prev_hash, hash
      from handover.contract_events where contract_id = ${LEGACY}::uuid order by seq`.execute(
      db,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[1].prev_hash).toBe(rows[0].hash);
    expect(verifyChain(LEGACY, rows, nodeSha256).ok).toBe(true);
  });
});

describe("contracts", () => {
  it("belong to svc_handover alone", async () => {
    await as(
      "svc_handover",
      "select * from handover.contracts; select * from handover.participants",
    );
    for (const role of ["svc_gateway", "svc_notifier", "anon"]) {
      await expect(
        as(role, "select * from handover.contracts"),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("have one accessor at most", async () => {
    await expect(
      sql`insert into handover.participants (contract_id, user_id, role, position)
          values (${LEGACY}::uuid, 'user_x', 'accessor', 0)`.execute(db),
    ).rejects.toThrow(/participants_one_accessor_idx/);
  });
});

describe("routing", () => {
  it("sends account deletions and the daily jobs to handover", async () => {
    const { rows } = await sql<{ event_type: string }>`
      select event_type from messaging.subscriptions where queue = 'handover' order by 1`.execute(
      db,
    );
    expect(rows.map((r) => r.event_type)).toEqual([
      "maintenance.audit_verify_due",
      "maintenance.retention_due",
      "user.deleted",
    ]);
  });
});
