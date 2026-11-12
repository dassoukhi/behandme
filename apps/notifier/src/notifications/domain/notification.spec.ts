import { describe, expect, it } from "vitest";
import { render, shouldPush } from "./notification.js";
import {
  interpretOutcome,
  MAX_SEND_ATTEMPTS,
  pushMessage,
  retryDelayMs,
} from "./push.js";
import * as templates from "./templates.js";
import { trustAdded } from "./templates.js";

describe("trust_added", () => {
  it("names the person who added you and opens their profile", () => {
    const draft = trustAdded({
      userId: "user_b",
      ownerId: "user_a",
      ownerName: "Sam Durand",
    });
    expect(render(draft, "fr")).toEqual({
      userId: "user_b",
      type: "trust_added",
      title: "Nouveau proche",
      body: "Sam Durand vous a ajouté à ses proches.",
      data: { url: "/people/user_a" },
      critical: false,
    });
  });

  it("stays polite when the person has no name", () => {
    const draft = trustAdded({ userId: "b", ownerId: "a", ownerName: null });
    expect(render(draft, "fr").body).toBe(
      "Quelqu'un vous a ajouté à ses proches.",
    );
    expect(render(draft, "en").body).toBe(
      "Someone added you as a trusted contact.",
    );
  });
});

describe("copy", () => {
  const ids = {
    userId: "u",
    ownerId: "o",
    validatorId: "v",
    accessorId: "a",
    trusterId: "t",
    contractId: "c",
    ownerName: null,
    userName: null,
    quorum: false,
    reason: "cancelled",
    role: "accessor",
    claimantId: "a",
    contestUntil: "2026-11-19T13:30:00.000Z",
    usableFrom: "2026-11-15T13:30:00.000Z",
  };
  const categories = {
    networks: ["Réseaux sociaux", "Social media"],
    devices: ["Appareils", "Devices"],
    storage: ["Stockage en ligne", "Online storage"],
  } as const;

  it.each(Object.entries(templates))(
    "%s is written in both languages and names the category in each",
    (_name, template) => {
      for (const [category, [fr, en]] of Object.entries(categories)) {
        const draft = template({ ...ids, category });
        expect(render(draft, "fr").title).not.toBe(render(draft, "en").title);
        expect(render(draft, "fr").body).not.toBe(render(draft, "en").body);
        if (draft.data.url.startsWith("/contract/")) {
          expect(render(draft, "fr").body).toContain(`« ${fr} »`);
          expect(render(draft, "en").body).toContain(`“${en}”`);
        }
      }
    },
  );
});

describe("push", () => {
  const draft = render(
    trustAdded({ userId: "b", ownerId: "a", ownerName: "Sam" }),
    "fr",
  );

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
