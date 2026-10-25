import {
  Injectable,
  type INestApplication,
  UnauthorizedException,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PassportStrategy } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import { sql } from "kysely";
import { Strategy } from "passport-custom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE } from "@lib/platform";
import { startTestDatabase, type TestDatabase } from "@lib/testing";

// The gateway's HTTP API with its real guards, on PGlite: a bearer token here is just the user id.
process.env.NODE_ENV = "test";
process.env.CLERK_SECRET_KEY = "placeholder";
process.env.DATABASE_URL = "postgresql://unused@localhost/unused";
process.env.NOTIFIER_URL = "http://localhost:3001";
process.env.HANDOVER_URL = "http://localhost:3003";
process.env.INTERNAL_JWT_SECRET = "a-secret-of-at-least-thirty-two-characters";
process.env.MESSAGING_ENABLED = "false";

@Injectable()
class FakeClerkStrategy extends PassportStrategy(Strategy, "clerk") {
  validate(req: Request) {
    const id = req.headers.authorization?.replace("Bearer ", "");
    if (!id) throw new UnauthorizedException("No token provided");
    return { id, fva: null };
  }
}

let t: TestDatabase;
let app: INestApplication;
let base: string;
let RATE_LIMIT: { perMinute: number; searchPerMinute: number };

beforeAll(async () => {
  t = await startTestDatabase();
  await sql`set role svc_gateway`.execute(t.db);
  const { AppModule } = await import("./app.module.js");
  const { ClerkStrategy } = await import("./auth/clerk.strategy.js");
  const { configureGateway } = await import("./setup.js");
  ({ RATE_LIMIT } = await import("./common/throttle/user-throttler.guard.js"));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(t.db)
    .overrideProvider(ClerkStrategy)
    .useClass(FakeClerkStrategy)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureGateway(app as NestExpressApplication);
  await app.listen(0);
  base = await app.getUrl();
}, 60_000);
afterAll(async () => {
  await app?.close(); // also closes t.db
  await t?.close();
});

const search = (as: string) =>
  fetch(`${base}/api/v1/users/search?q=nina`, {
    headers: { authorization: `Bearer ${as}` },
  });

describe("rate limit", () => {
  it("stops one person's searches after the limit, in French, and not someone else's", async () => {
    for (let i = 0; i < RATE_LIMIT.searchPerMinute; i++) {
      expect((await search("user_alice")).status).toBe(200);
    }
    const refused = await search("user_alice");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      message: "Trop de requêtes : réessayez dans une minute.",
    });
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect((await search("user_bob")).status).toBe(200);
  });

  it("never limits the host's health check", async () => {
    for (let i = 0; i <= RATE_LIMIT.perMinute; i++) {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
    }
  });
});

describe("API docs", () => {
  it("are served in development only, unless asked for in production", async () => {
    const { docsEnabled } = await import("./setup.js");
    expect(docsEnabled("development", undefined)).toBe(true);
    expect(docsEnabled("production", undefined)).toBe(false);
    expect(docsEnabled("production", "true")).toBe(true);
  });
});
