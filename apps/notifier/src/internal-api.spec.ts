import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE, signInternalToken } from "@lib/platform";
import { startTestDatabase, type TestDatabase } from "@lib/testing";

// The notifier's HTTP API as the gateway calls it: the whole app on PGlite, without background loops.
const SECRET = "a-secret-of-at-least-thirty-two-characters";
process.env.DATABASE_URL = "postgresql://unused@localhost/unused";
process.env.INTERNAL_JWT_SECRET = SECRET;
process.env.MESSAGING_ENABLED = "false";

let t: TestDatabase;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  t = await startTestDatabase();
  await sql`
    insert into notify.notifications (id, user_id, type, title, body) values
      ('6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f', 'user_a', 'trust_added', 'T', 'B'),
      ('7f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f', 'user_b', 'trust_added', 'T', 'B');
    set role svc_notifier;
  `.execute(t.db);
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
  init: RequestInit & {
    as?: string | null;
    audience?: string;
    secret?: string;
  } = {},
) {
  const {
    as = "user_a",
    audience = "notifier",
    secret = SECRET,
    ...rest
  } = init;
  const token =
    as === null
      ? undefined
      : await signInternalToken(secret, {
          issuer: "gateway",
          audience,
          userId: as,
        });
  return fetch(`${base}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(rest.headers as Record<string, string> | undefined),
      ...(token && { authorization: `Bearer ${token}` }),
    },
  });
}

describe("internal API", () => {
  it("answers health checks without a token", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it.each([
    ["no token", { as: null }],
    ["a token for another service", { audience: "worker" }],
    ["a token signed with another secret", { secret: "x".repeat(40) }],
  ])("refuses a request with %s", async (_case, init) => {
    const res = await call("/internal/v1/inbox", init);
    expect(res.status).toBe(401);
  });

  it("serves the user named by the token only, under the caller's correlation id", async () => {
    const res = await call("/internal/v1/inbox", {
      headers: { "x-correlation-id": "corr-from-gateway" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe("corr-from-gateway");
    const body = await res.json();
    expect(body.map((n: { id: string }) => n.id)).toEqual([
      "6f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f",
    ]);
  });

  it("answers 404 for another user's notification, 400 for a malformed id", async () => {
    const other = await call(
      "/internal/v1/inbox/7f1c2b8e-4a7d-4e2b-9f3a-1d2c3b4a5e6f",
      {
        method: "PATCH",
        body: JSON.stringify({ read: true }),
      },
    );
    expect(other.status).toBe(404);
    expect((await other.json()).message).toBe("Notification not found");
    const malformed = await call("/internal/v1/inbox/not-a-uuid", {
      method: "DELETE",
    });
    expect(malformed.status).toBe(400);
  });

  it("validates bodies (whitelist)", async () => {
    const res = await call("/internal/v1/push-tokens", {
      method: "POST",
      body: JSON.stringify({
        token: "ExponentPushToken[a]",
        user_id: "user_b",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("registers a device and updates settings", async () => {
    const register = await call("/internal/v1/push-tokens", {
      method: "POST",
      body: JSON.stringify({ token: "ExponentPushToken[a]" }),
    });
    expect(register.status).toBe(204);
    const prefs = await call("/internal/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({ push_enabled: false }),
    });
    expect(await prefs.json()).toEqual({ push_enabled: false });
    const count = await call("/internal/v1/inbox/unread-count");
    expect(await count.json()).toEqual({ count: 1 });
  });
});
