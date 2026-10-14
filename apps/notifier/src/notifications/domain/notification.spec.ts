import { describe, expect, it } from "vitest";
import { shouldPush } from "./notification.js";
import {
  interpretOutcome,
  MAX_SEND_ATTEMPTS,
  pushMessage,
  retryDelayMs,
} from "./push.js";
import { trustAdded } from "./templates.js";

describe("trust_added", () => {
  it("names the person who added you and opens their profile", () => {
    const draft = trustAdded({
      userId: "user_b",
      ownerId: "user_a",
      ownerName: "Sam Durand",
    });
    expect(draft).toEqual({
      userId: "user_b",
      type: "trust_added",
      title: "Nouveau proche",
      body: "Sam Durand vous a ajouté à ses proches.",
      data: { url: "/people/user_a" },
      critical: false,
    });
  });

  it("stays polite when the person has no name", () => {
    expect(
      trustAdded({ userId: "b", ownerId: "a", ownerName: null }).body,
    ).toBe("Quelqu'un vous a ajouté à ses proches.");
  });
});

describe("push", () => {
  const draft = trustAdded({ userId: "b", ownerId: "a", ownerName: "Sam" });

  it("respects the user's choice, except for critical notifications", () => {
    expect(shouldPush(draft, { push_enabled: true })).toBe(true);
    expect(shouldPush(draft, { push_enabled: false })).toBe(false);
    expect(
      shouldPush({ ...draft, critical: true }, { push_enabled: false }),
    ).toBe(true);
  });

  it("sends a normal notification quietly, a critical one as time-sensitive", () => {
    expect(pushMessage(draft, "n1", 3)).toEqual({
      title: "Nouveau proche",
      body: "Sam vous a ajouté à ses proches.",
      data: { url: "/people/a", type: "trust_added", notificationId: "n1" },
      sound: "default",
      badge: 3,
      priority: "default",
      channelId: "default",
      interruptionLevel: "active",
    });
    expect(pushMessage({ ...draft, critical: true }, "n1", 1)).toMatchObject({
      priority: "high",
      channelId: "critical",
      interruptionLevel: "time-sensitive",
    });
  });

  it("forgets a device only when Expo says it is no longer registered", () => {
    expect(interpretOutcome({ status: "ok", id: "t1" })).toEqual({
      failed: false,
      error: null,
      deviceGone: false,
    });
    expect(
      interpretOutcome({
        status: "error",
        message: "not registered",
        error: "DeviceNotRegistered",
      }),
    ).toEqual({ failed: true, error: "DeviceNotRegistered", deviceGone: true });
    expect(
      interpretOutcome({
        status: "error",
        message: "too many",
        error: "MessageRateExceeded",
      }),
    ).toMatchObject({ failed: true, deviceGone: false });
  });

  it("waits longer after each failed send, up to an hour", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(MAX_SEND_ATTEMPTS)).toBe(480_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
