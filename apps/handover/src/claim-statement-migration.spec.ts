import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  trackedMigrations,
  type TestDatabase,
} from "@lib/testing";

// supabase/migrations/20261122180000_claim_statement.sql, applied after claims exist, as on the hosted database.
const MIGRATION = trackedMigrations().find((file) =>
  file.endsWith("_claim_statement.sql"),
)!;
const read = (file: string) =>
  readFileSync(
    new URL(`../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
const CONTRACT = "6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f";
const WHY = "Hospitalisée depuis le 3 mars, dans le coma.";

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
        values ('${CONTRACT}', 'user_o', 'networks', 'claimed', 1);
      insert into handover.claims (contract_id, claimant_id, sealed_version, contest_until, expires_at, reason)
        values ('${CONTRACT}', 'user_a', 1, now(), now(), 'death');`,
    )
    .execute(db);
  await sql.raw(read(MIGRATION)).execute(db);
}, 60_000);
afterAll(() => t?.close());

const setOnClaim = (reason: string, statement: string) =>
  t.asRole("svc_handover", (d) =>
    sql`update handover.claims set reason = ${reason}, statement = ${statement}`.execute(
      d,
    ),
  );

describe("handover.claims.statement", () => {
  it("leaves the existing claims without a statement", async () => {
    const { rows } = await sql`select statement from handover.claims`.execute(
      db,
    );
    expect(rows).toEqual([{ statement: null }]);
  });

  it("keeps 20 to 1,000 characters, for a claim for an incapacity only", async () => {
    await setOnClaim("incapacity", WHY);
    await expect(setOnClaim("incapacity", "Trop court.")).rejects.toThrow(
      /check constraint/,
    );
    await expect(setOnClaim("incapacity", "x".repeat(1001))).rejects.toThrow(
      /check constraint/,
    );
    await expect(setOnClaim("death", WHY)).rejects.toThrow(/check constraint/);
  });

  it("can be applied twice", async () => {
    await expect(sql.raw(read(MIGRATION)).execute(db)).resolves.toBeDefined();
  });

  it("stays handover's alone", async () => {
    await expect(
      t.asRole("svc_gateway", (d) =>
        sql`select statement from handover.claims`.execute(d),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
