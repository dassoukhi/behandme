import { afterEach, describe, expect, it, vi } from "vitest";
import { Expo } from "expo-server-sdk";
import { ExpoPushGateway } from "./expo-push.gateway.js";
import type { PushMessage } from "../domain/push.js";

const OLD = "ExponentPushToken[old-project]";
const NEW = "ExponentPushToken[new-project]";
const NEW2 = "ExponentPushToken[new-project-2]";
const message = (to: string): PushMessage & { to: string } => ({
  to,
  title: "t",
  body: "b",
  data: {},
  sound: "default",
  badge: 1,
  priority: "default",
  channelId: "default",
  interruptionLevel: "active",
});

function mixedProjects(groups: Record<string, string[]>) {
  return Object.assign(new Error("same project"), {
    code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
    details: groups,
  });
}

describe("ExpoPushGateway", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends each Expo project's tokens on their own and keeps the order", async () => {
    const send = vi
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation(async (chunk) => {
        const tokens = chunk.map((m) => m.to as string);
        if (tokens.includes(OLD) && tokens.includes(NEW)) {
          throw mixedProjects({
            "@tuku/behindMe": [OLD],
            "@tuku/behyndme": [NEW, NEW2],
          });
        }
        return tokens.map((t) =>
          t === OLD
            ? {
                status: "error" as const,
                message: "no key",
                details: { error: "InvalidCredentials" as const },
              }
            : { status: "ok" as const, id: `ticket-${t}` },
        );
      });

    const outcomes = await new ExpoPushGateway(undefined).send([
      message(NEW),
      message(OLD),
      message(NEW2),
    ]);

    expect(outcomes).toEqual([
      { status: "ok", id: `ticket-${NEW}` },
      { status: "error", message: "no key", error: "InvalidCredentials" },
      { status: "ok", id: `ticket-${NEW2}` },
    ]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("lets any other Expo error through, so that the send is retried", async () => {
    vi.spyOn(Expo.prototype, "sendPushNotificationsAsync").mockRejectedValue(
      new Error("Expo down"),
    );
    await expect(
      new ExpoPushGateway(undefined).send([message(NEW)]),
    ).rejects.toThrow("Expo down");
  });
});
