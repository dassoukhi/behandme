import { describe, expect, it } from "vitest";
import { createEnvelope, MalformedMessageError } from "@lib/messaging";
import { FakeClock } from "@lib/testing";
import { on } from "./event-definition.js";
import { TrustAdded } from "./events.js";

const clock = new FakeClock();
const envelope = (event: { type: string; version: number; payload: unknown }) =>
  createEnvelope(event, { correlationId: "c" }, clock);

describe("event definitions", () => {
  it("check the payload when publishing", () => {
    expect(
      TrustAdded.create({ ownerId: "a", trustedId: "b", ownerName: null }),
    ).toEqual({
      type: "trust.added",
      version: 1,
      payload: { ownerId: "a", trustedId: "b", ownerName: null },
    });
    expect(() =>
      TrustAdded.create({ ownerId: "", trustedId: "b", ownerName: null }),
    ).toThrow();
  });

  it.each([
    ["another version", { type: "trust.added", version: 2, payload: {} }],
    [
      "a payload missing a field",
      {
        type: "trust.added",
        version: 1,
        payload: { ownerId: "a", trustedId: "b" },
      },
    ],
  ])("refuse %s when consuming, as a malformed message", (_case, event) => {
    expect(() => TrustAdded.parse(envelope(event))).toThrow(
      MalformedMessageError,
    );
  });

  it("give a handler the checked payload", async () => {
    const seen: unknown[] = [];
    const [type, handler] = on(TrustAdded, async (payload) => {
      seen.push(payload);
    });
    expect(type).toBe("trust.added");
    await handler(
      envelope(
        TrustAdded.create({ ownerId: "a", trustedId: "b", ownerName: "Sam" }),
      ),
      {} as never,
    );
    expect(seen).toEqual([{ ownerId: "a", trustedId: "b", ownerName: "Sam" }]);
  });
});
