import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { currentCorrelationId } from "@lib/kernel";
import { correlationMiddleware } from "./correlation.middleware.js";
import { signInternalToken, verifyInternalToken } from "./internal-token.js";
import { PollingLoop } from "./polling-loop.js";
import { serviceConfig, serviceEnv } from "./service-config.js";

const SECRET = "a-secret-of-at-least-thirty-two-characters";

describe("internal token", () => {
  it("names the calling service and the user", async () => {
    const token = await signInternalToken(SECRET, {
      issuer: "gateway",
      audience: "notifier",
      userId: "user_a",
    });
    await expect(
      verifyInternalToken(SECRET, token, "notifier"),
    ).resolves.toEqual({
      service: "gateway",
      userId: "user_a",
    });
  });

  it("can be issued for no user", async () => {
    const token = await signInternalToken(SECRET, {
      issuer: "worker",
      audience: "notifier",
      userId: null,
    });
    await expect(
      verifyInternalToken(SECRET, token, "notifier"),
    ).resolves.toEqual({
      service: "worker",
      userId: null,
    });
  });

  it("is refused once expired, or without an expiry", async () => {
    const key = new TextEncoder().encode(SECRET);
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("gateway")
      .setAudience("notifier")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key);
    const eternal = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("gateway")
      .setAudience("notifier")
      .sign(key);
    await expect(
      verifyInternalToken(SECRET, expired, "notifier"),
    ).rejects.toThrow();
    await expect(
      verifyInternalToken(SECRET, eternal, "notifier"),
    ).rejects.toThrow();
  });

  it("needs a long secret", async () => {
    await expect(
      signInternalToken("short", { issuer: "a", audience: "b", userId: null }),
    ).rejects.toThrow(/at least 32/);
  });
});

describe("correlation middleware", () => {
  function run(header?: string) {
    let seen: string | undefined;
    const res = { setHeader: vi.fn() };
    correlationMiddleware(
      { header: () => header } as never,
      res as never,
      () => {
        seen = currentCorrelationId();
      },
    );
    return { seen, sent: res.setHeader.mock.calls[0][1] };
  }

  it("keeps the caller's id when it is well formed", () => {
    expect(run("corr-1234-abcd")).toEqual({
      seen: "corr-1234-abcd",
      sent: "corr-1234-abcd",
    });
  });

  it.each([undefined, "short", "with spaces and; injection"])(
    "creates an id when given %s",
    (header) => {
      const { seen, sent } = run(header);
      expect(seen).toMatch(/^[0-9a-f-]{36}$/);
      expect(sent).toBe(seen);
    },
  );
});

describe("polling loop", () => {
  afterEach(() => vi.useRealTimers());
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  it("runs again at once while there is work, then waits when idle", async () => {
    vi.useFakeTimers();
    const results = [3, 2, 0, 0];
    const run = vi.fn(async () => results.shift() ?? 0);
    const loop = new PollingLoop({ name: "test", run, logger, idleMs: 1000 });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(4);
    await loop.stop();
  });

  it("waits longer after each failure, and recovers", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(0);
    const loop = new PollingLoop({ name: "test", run, logger, idleMs: 100 });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200); // 100 × 2¹
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // 100 × 2²
    expect(run).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("2 in a row"),
    );
    await loop.stop();
  });

  it("stops without waiting for the idle delay, after the batch in progress", async () => {
    let finish!: () => void;
    const run = vi.fn(
      () => new Promise<number>((resolve) => (finish = () => resolve(0))),
    );
    const loop = new PollingLoop({ name: "test", run, logger, idleMs: 60_000 });
    loop.start();
    const stopped = loop.stop();
    let done = false;
    void stopped.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await stopped;
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("service config", () => {
  const config = serviceConfig(
    "notifier",
    serviceEnv.extend({ PORT: z.coerce.number() }),
  );

  it("reads the service's own env file first", () => {
    expect(config.envFilePath).toEqual([".env.notifier", ".env"]);
  });

  it("names every missing or invalid variable", () => {
    expect(() =>
      config.validate({ INTERNAL_JWT_SECRET: "short", PORT: "3001" }),
    ).toThrow(/notifier[\s\S]*DATABASE_URL[\s\S]*INTERNAL_JWT_SECRET/);
  });

  it("converts and defaults values", () => {
    expect(
      config.validate({
        DATABASE_URL: "postgresql://x",
        INTERNAL_JWT_SECRET: SECRET,
        PORT: "3001",
      }),
    ).toMatchObject({ NODE_ENV: "development", PORT: 3001 });
  });
});
