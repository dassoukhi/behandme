import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE, signInternalToken } from "@lib/platform";
import { startTestDatabase, type TestDatabase } from "@lib/testing";

// Handover's HTTP API as the gateway calls it: the whole app on PGlite, without background loops.
const SECRET = "a-secret-of-at-least-thirty-two-characters";
process.env.DATABASE_URL = "postgresql://unused@localhost/unused";
process.env.INTERNAL_JWT_SECRET = SECRET;
process.env.MESSAGING_ENABLED = "false";

let t: TestDatabase;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  t = await startTestDatabase();
  await sql`set role svc_handover`.execute(t.db);
  const { AppModule } = await import("./app.module.js");
  const { configureApp } = await import("./setup.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(t.db)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0);
  base = await app.getUrl();
}, 60_000);
afterAll(async () => {
  await app?.close(); // also closes t.db
  await t?.close();
});

async function call(
  path: string,
  init: RequestInit & { as?: string | null; audience?: string } = {},
) {
  const { as = "user_owner", audience = "handover", ...rest } = init;
  const token =
    as === null
      ? undefined
      : await signInternalToken(SECRET, {
          issuer: "gateway",
          audience,
          userId: as,
        });
  return fetch(`${base}/internal/v1${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
  });
}

const draft = {
  category: "networks",
  description: "Mes réseaux",
  accessor_id: "user_accessor",
  validator_ids: ["user_validator"],
};

describe("internal API", () => {
  it.each([
    ["no token", { as: null }],
    ["a token for the notifier", { audience: "notifier" }],
  ])("refuses a request with %s", async (_case, init) => {
    expect((await call("/contracts", init)).status).toBe(401);
  });

  it("creates a contract for the user named by the token, never one from the body", async () => {
    const forged = await call("/contracts", {
      method: "POST",
      body: JSON.stringify({ ...draft, owner_id: "user_other" }),
    });
    expect(forged.status).toBe(400);

    const created = await call("/contracts", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    expect(created.status).toBe(201);
    const contract = await created.json();
    expect(contract).toMatchObject({ owner_id: "user_owner", status: "draft" });

    const stranger = await call(`/contracts/${contract.id}`, {
      as: "user_stranger",
    });
    expect(stranger.status).toBe(404);

    const log = await call(`/contracts/${contract.id}/events`, {
      as: "user_validator",
    });
    expect((await log.json()).map((e: { type: string }) => e.type)).toEqual([
      "contract.created",
    ]);
    const check = await call(`/contracts/${contract.id}/events/verify`);
    expect(await check.json()).toMatchObject({ ok: true, length: 1 });
  });

  it("answers 409 to deleting a contract that is no longer a draft", async () => {
    const contract = await (
      await call("/contracts", { method: "POST", body: JSON.stringify(draft) })
    ).json();
    await sql`reset role`.execute(t.db);
    await sql`update handover.contracts set status = 'active' where id = ${contract.id}::uuid`.execute(
      t.db,
    );
    await sql`set role svc_handover`.execute(t.db);
    const res = await call(`/contracts/${contract.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  it("lets the owner choose up to 90 days to cancel a claim", async () => {
    const create = (contest_days: number) =>
      call("/contracts", {
        method: "POST",
        body: JSON.stringify({ ...draft, contest_days }),
      });
    const created = await create(90);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ contest_days: 90 });
    expect((await create(91)).status).toBe(400);
  });

  it("asks a claim for a reason it knows", async () => {
    const contract = await (
      await call("/contracts", { method: "POST", body: JSON.stringify(draft) })
    ).json();
    for (const body of [{}, { reason: "absence" }]) {
      const res = await call(`/contracts/${contract.id}/claims`, {
        method: "POST",
        as: "user_validator",
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it("lets a participant refuse their role, after which the contract is none of theirs", async () => {
    const contract = await (
      await call("/contracts", { method: "POST", body: JSON.stringify(draft) })
    ).json();
    const leave = (as: string) =>
      call(`/contracts/${contract.id}/leave`, { method: "POST", as });
    expect((await leave("user_owner")).status).toBe(404);
    expect((await leave("user_stranger")).status).toBe(404);
    expect((await leave("user_validator")).status).toBe(204);
    expect(
      (await call(`/contracts/${contract.id}`, { as: "user_validator" }))
        .status,
    ).toBe(404);
    expect((await leave("user_validator")).status).toBe(404);
    const forOwner = await (await call(`/contracts/${contract.id}`)).json();
    expect(forOwner.departures).toMatchObject([
      { user_id: "user_validator", role: "validator", reason: "declined" },
    ]);
  });
});
