import { describe, expect, it } from "vitest";
import { FakeClock } from "@lib/testing";
import { causedBy, createEnvelope, isEnvelope } from "./envelope.js";

const clock = new FakeClock(new Date("2026-03-01T10:00:00.000Z"));

describe("event envelope", () => {
  it("stamps id, time and trace context", () => {
    const envelope = createEnvelope(
      { type: "trust.added", version: 1, payload: { ownerId: "user_a" } },
      { correlationId: "corr-1" },
      clock,
    );
    expect(envelope).toMatchObject({
      type: "trust.added",
      version: 1,
      occurredAt: "2026-03-01T10:00:00.000Z",
      correlationId: "corr-1",
      causationId: null,
      payload: { ownerId: "user_a" },
    });
    expect(isEnvelope(envelope)).toBe(true);
  });

  it("chains the events published while handling another one", () => {
    const cause = createEnvelope(
      { type: "claim.filed", version: 1, payload: {} },
      { correlationId: "corr-2" },
      clock,
    );
    const effect = createEnvelope(
      { type: "notification.requested", version: 1, payload: {} },
      causedBy(cause),
      clock,
    );
    expect(effect.correlationId).toBe("corr-2");
    expect(effect.causationId).toBe(cause.id);
    expect(effect.id).not.toBe(cause.id);
  });

  it.each([
    ["null", null],
    ["a string", "claim.filed"],
    [
      "no id",
      {
        type: "x",
        version: 1,
        occurredAt: "",
        correlationId: "c",
        causationId: null,
        payload: {},
      },
    ],
    [
      "a non-uuid id",
      {
        id: "1",
        type: "x",
        version: 1,
        occurredAt: "",
        correlationId: "c",
        causationId: null,
        payload: {},
      },
    ],
    [
      "a decimal version",
      {
        id: "6f1c1f4e-8f4a-4b8e-9d6a-1d2f3c4b5a69",
        type: "x",
        version: 1.5,
        occurredAt: "",
        correlationId: "c",
        causationId: null,
        payload: {},
      },
    ],
    [
      "no payload",
      {
        id: "6f1c1f4e-8f4a-4b8e-9d6a-1d2f3c4b5a69",
        type: "x",
        version: 1,
        occurredAt: "",
        correlationId: "c",
        causationId: null,
      },
    ],
  ])("rejects %s as an envelope", (_label, value) => {
    expect(isEnvelope(value)).toBe(false);
  });
});
