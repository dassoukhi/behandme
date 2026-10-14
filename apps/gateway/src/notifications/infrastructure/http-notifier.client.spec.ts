import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError, withCorrelation } from "@lib/kernel";
import { verifyInternalToken } from "@lib/platform";
import { HttpNotifierClient } from "./http-notifier.client.js";

const SECRET = "a-secret-of-at-least-thirty-two-characters";

function client(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      const next = responses.shift();
      if (!next) throw new Error("no response left");
      if (next instanceof Error) throw next;
      return next;
    },
  );
  return {
    notifier: new HttpNotifierClient({
      baseUrl: "http://notifier:3001/",
      secret: SECRET,
      fetch: fetch as typeof globalThis.fetch,
    }),
    calls,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("HttpNotifierClient", () => {
  it("calls the internal API for the user, with a token only the notifier accepts", async () => {
    const { notifier, calls } = client(json(200, { count: 2 }));

    await expect(
      withCorrelation("corr-12345678", () => notifier.unreadCount("user_a")),
    ).resolves.toEqual({ count: 2 });

    expect(calls[0].url).toBe(
      "http://notifier:3001/internal/v1/inbox/unread-count",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-correlation-id"]).toBe("corr-12345678");
    const token = headers.authorization.replace("Bearer ", "");
    await expect(
      verifyInternalToken(SECRET, token, "notifier"),
    ).resolves.toEqual({ service: "gateway", userId: "user_a" });
    await expect(
      verifyInternalToken(SECRET, token, "worker"),
    ).rejects.toThrow();
  });

  it("sends bodies as JSON and encodes ids in the path", async () => {
    const { notifier, calls } = client(json(200, { id: "n/1" }));
    await notifier.markRead("user_a", "n/1", true);
    expect(calls[0].url).toBe("http://notifier:3001/internal/v1/inbox/n%2F1");
    expect(calls[0].init).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    });
  });

  it("turns a 404 into NotFoundError with the notifier's message", async () => {
    const { notifier } = client(
      json(404, { statusCode: 404, message: "Notification not found" }),
    );
    await expect(notifier.markRead("user_a", "x", true)).rejects.toThrow(
      new NotFoundError("Notification not found"),
    );
  });

  it("retries an idempotent call once when the notifier is restarting", async () => {
    const { notifier, calls } = client(
      json(503, { message: "starting" }),
      json(200, { updated: 1 }),
    );
    await expect(notifier.markAllRead("user_a")).resolves.toEqual({
      updated: 1,
    });
    expect(calls).toHaveLength(2);
  });

  it("retries once after a network error, then reports the notifier unavailable", async () => {
    const { notifier, calls } = client(
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    );
    await expect(notifier.inbox("user_a")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(calls).toHaveLength(2);
  });

  it("never retries deleting a notification", async () => {
    const { notifier, calls } = client(new TypeError("fetch failed"));
    await expect(notifier.remove("user_a", "n1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(calls).toHaveLength(1);
  });
});
