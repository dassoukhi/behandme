import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConflictError, InvalidInputError, NotFoundError } from "@lib/kernel";
import fixture from "../testing/chain-v1.json" with { type: "json" };
import { type ChainEvent, verifyChain } from "./audit-chain.js";
import { contractCreated, contractUpdated } from "./audit-events.js";
import {
  assertCategoryRules,
  assertValidDraft,
  changedFields,
  claimReasons,
  type Contract,
  type Departure,
  presentParticipants,
  roleOf,
} from "./contract.js";
import { allowedActions, assertAllowed } from "./lifecycle.js";

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const draft: Contract = {
  id: "c1",
  ownerId: "owner",
  category: "networks",
  description: "Mes réseaux",
  status: "draft",
  version: 1,
  sealedVersion: 0,
  contestDays: 7,
  incapacityAllowed: false,
  accessorId: "acc",
  validatorIds: ["v1", "v2"],
  departures: [],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};
const left = (
  userId: string,
  role: Departure["role"] = "validator",
): Departure => ({
  userId,
  role,
  reason: "declined",
  at: "2026-10-20T00:00:00.000Z",
});
const input = {
  category: "networks" as const,
  description: null,
  accessorId: "acc",
  validatorIds: ["v1"],
};

describe("draft rules", () => {
  it("accepts an accessor and 1 to 3 distinct validators other than the owner", () => {
    expect(() => assertValidDraft("owner", input)).not.toThrow();
    expect(() =>
      assertValidDraft("owner", { ...input, validatorIds: ["v1", "v2", "v3"] }),
    ).not.toThrow();
  });

  it.each([
    ["no validator", { validatorIds: [] }],
    ["four validators", { validatorIds: ["a", "b", "c", "d"] }],
    ["a validator twice", { validatorIds: ["v1", "v1"] }],
    ["the owner as accessor", { accessorId: "owner" }],
    ["the owner as validator", { validatorIds: ["owner"] }],
    ["the accessor as validator", { validatorIds: ["acc"] }],
    ["no accessor", { accessorId: "" }],
    ["an unknown category", { category: "bank" }],
    ["a description over 280 characters", { description: "x".repeat(281) }],
  ])("refuses %s", (_case, change) => {
    expect(() =>
      assertValidDraft("owner", { ...input, ...change } as never),
    ).toThrow(InvalidInputError);
  });

  it("keeps bank accounts and cryptocurrency to 3 validators, 15 days or more, and a handover after a death", () => {
    const finances = {
      ...input,
      category: "finances" as const,
      validatorIds: ["v1", "v2", "v3"],
    };
    // 15 days when none is chosen: enough for finances too.
    expect(() => assertValidDraft("owner", finances)).not.toThrow();
    expect(() =>
      assertValidDraft("owner", { ...finances, contestDays: 30 }),
    ).not.toThrow();
    for (const change of [
      { validatorIds: ["v1", "v2"] },
      { contestDays: 14 },
      { incapacityAllowed: true },
    ]) {
      expect(() =>
        assertValidDraft("owner", { ...finances, ...change }),
      ).toThrow(InvalidInputError);
    }
    // The other categories keep their freedom: 1 validator, 3 days, an incapacity.
    expect(() =>
      assertCategoryRules({
        category: "networks",
        contestDays: 3,
        incapacityAllowed: true,
        validatorCount: 1,
      }),
    ).not.toThrow();
  });

  it("allows a claim for an incapacity only where the owner consented to it, never for finances", () => {
    expect(
      claimReasons({ category: "networks", incapacityAllowed: false }),
    ).toEqual(["death"]);
    expect(
      claimReasons({ category: "devices", incapacityAllowed: true }),
    ).toEqual(["death", "incapacity"]);
    expect(
      claimReasons({ category: "finances", incapacityAllowed: true }),
    ).toEqual(["death"]);
  });

  it("gives each user their role, or none", () => {
    expect(roleOf(draft, "owner")).toBe("owner");
    expect(roleOf(draft, "acc")).toBe("accessor");
    expect(roleOf(draft, "v2")).toBe("validator");
    expect(roleOf(draft, "stranger")).toBeNull();
  });

  it("gives no role to a participant who left, and tells only those who stayed", () => {
    const after = {
      ...draft,
      departures: [left("v1"), left("acc", "accessor")],
    };
    expect(roleOf(after, "v1")).toBeNull();
    expect(roleOf(after, "acc")).toBeNull();
    expect(roleOf(after, "v2")).toBe("validator");
    expect(roleOf(after, "owner")).toBe("owner");
    expect(presentParticipants(after)).toEqual({
      accessorId: null,
      validatorIds: ["v2"],
    });
    expect(presentParticipants(draft)).toEqual({
      accessorId: "acc",
      validatorIds: ["v1", "v2"],
    });
  });

  it("lists only the fields a change really changes", () => {
    expect(
      changedFields(draft, { category: "networks", description: "Autre" }),
    ).toEqual(["description"]);
    expect(changedFields(draft, { description: undefined })).toEqual([]);
  });
});

describe("life cycle", () => {
  it("lets the owner edit, delete and seal a draft; the others may only refuse their role", () => {
    expect(allowedActions(draft, "owner")).toEqual([
      "update",
      "delete",
      "seal",
    ]);
    expect(allowedActions(draft, "accessor")).toEqual(["leave"]);
    expect(allowedActions(draft, "validator")).toEqual(["leave"]);
  });

  it("lets the owner edit, re-seal or revoke an active contract", () => {
    expect(allowedActions({ ...draft, status: "active" }, "owner")).toEqual([
      "update",
      "seal",
      "revoke",
    ]);
    expect(allowedActions({ ...draft, status: "active" }, "validator")).toEqual(
      ["claim", "leave"],
    );
  });

  it("lets the accessor or a validator refuse their role until the end, never the owner", () => {
    for (const status of ["draft", "active", "claimed"] as const) {
      for (const role of ["accessor", "validator"] as const) {
        expect(() =>
          assertAllowed("leave", { ...draft, status }, role),
        ).not.toThrow();
      }
      expect(() =>
        assertAllowed("leave", { ...draft, status }, "owner"),
      ).toThrow(NotFoundError);
    }
    for (const status of ["released", "revoked"] as const) {
      expect(() =>
        assertAllowed("leave", { ...draft, status }, "accessor"),
      ).toThrow(ConflictError);
    }
  });

  it("allows no claim that could not succeed: the accessor left, or too few validators remain", () => {
    const active = { ...draft, status: "active" as const };
    const three = { ...active, validatorIds: ["v1", "v2", "v3"] };
    const canClaim = (contract: Contract) =>
      allowedActions(contract, "validator", {
        me: "v2",
        claim: null,
        cooldownUntil: null,
      }).includes("claim");
    expect(canClaim(three)).toBe(true);
    // 2 approvals of 3 are needed: one may leave, not two.
    expect(canClaim({ ...three, departures: [left("v1")] })).toBe(true);
    expect(canClaim({ ...three, departures: [left("v1"), left("v3")] })).toBe(
      false,
    );
    // With 2 validators, both must approve.
    expect(canClaim({ ...active, departures: [left("v1")] })).toBe(false);
    expect(canClaim({ ...three, departures: [left("acc", "accessor")] })).toBe(
      false,
    );
    expect(() =>
      assertAllowed(
        "claim",
        { ...active, departures: [left("v1")] },
        "validator",
        {
          me: "v2",
          claim: null,
          cooldownUntil: null,
        },
      ),
    ).toThrow(ConflictError);
  });

  it("lets the owner revoke or cancel the claim, not re-seal, during a claim", () => {
    expect(allowedActions({ ...draft, status: "claimed" }, "owner")).toEqual([
      "revoke",
      "cancel_claim",
    ]);
  });

  it("leaves the owner no action on a released or revoked contract; the accessor opens a released one", () => {
    for (const status of ["released", "revoked"] as const) {
      expect(allowedActions({ ...draft, status }, "owner")).toEqual([]);
    }
    expect(
      allowedActions({ ...draft, status: "released" }, "accessor"),
    ).toEqual(["open"]);
  });

  it("lets the claimant withdraw, and each validator decide once", () => {
    const claimed = { ...draft, status: "claimed" as const };
    const context = (me: string, decidedByMe = false) => ({
      me,
      claim: { claimantId: "acc", decidedByMe },
      cooldownUntil: null,
    });
    expect(allowedActions(claimed, "accessor", context("acc"))).toEqual([
      "withdraw_claim",
      "leave",
    ]);
    expect(allowedActions(claimed, "validator", context("v1"))).toEqual([
      "decide",
      "leave",
    ]);
    expect(allowedActions(claimed, "validator", context("v1", true))).toEqual([
      "leave",
    ]);
    expect(() =>
      assertAllowed("withdraw_claim", claimed, "validator", context("v1")),
    ).toThrow(ConflictError);
  });

  it("makes a claimant whose claim the owner cancelled wait", () => {
    const active = { ...draft, status: "active" as const };
    expect(
      allowedActions(active, "accessor", {
        me: "acc",
        claim: null,
        cooldownUntil: new Date("2026-10-20T00:00:00Z"),
      }),
    ).toEqual(["leave"]);
  });

  it("answers not found to a role that never may, conflict to a wrong status", () => {
    expect(() => assertAllowed("delete", draft, "accessor")).toThrow(
      NotFoundError,
    );
    expect(() =>
      assertAllowed("delete", { ...draft, status: "active" }, "owner"),
    ).toThrow(ConflictError);
  });
});

describe("audit entries", () => {
  it("record ids and field names, never the description", () => {
    expect(contractCreated(draft)).toEqual({
      type: "contract.created",
      body: {
        category: "networks",
        accessor_id: "acc",
        validator_ids: ["v1", "v2"],
      },
    });
    expect(JSON.stringify(contractCreated(draft))).not.toContain("Mes réseaux");
    expect(contractUpdated(["description", "category"]).body).toEqual({
      fields: ["category", "description"],
    });
  });
});

describe("audit chain (fixture chain-v1.json, made by the database)", () => {
  const events = fixture.events as ChainEvent[];
  const id = fixture.contract_id;

  it("verifies", () => {
    expect(verifyChain(id, events, sha256)).toEqual({
      ok: true,
      length: 4,
      headHash: events[3].hash,
      brokenAt: null,
    });
  });

  it("verifies an empty log", () => {
    expect(verifyChain(id, [], sha256)).toMatchObject({
      ok: true,
      length: 0,
      headHash: null,
    });
  });

  it.each([
    ["an edited body", (e: ChainEvent[]) => (e[1].body = '{"fields":[]}'), 2],
    ["an edited actor", (e: ChainEvent[]) => (e[0].actor_id = "user_x"), 1],
    [
      "an edited time",
      (e: ChainEvent[]) => (e[2].occurred_at = "2020-01-01T00:00:00.000Z"),
      3,
    ],
    ["a removed event", (e: ChainEvent[]) => e.splice(1, 1), 2],
    ["two swapped events", (e: ChainEvent[]) => e.splice(1, 2, e[2], e[1]), 2],
    [
      "an event of another contract",
      (e: ChainEvent[]) => (e[3].contract_id = "x"),
      4,
    ],
    [
      "a rehashed event whose successor still points to the old hash",
      (e: ChainEvent[]) => {
        e[1].body = '{"fields":[]}';
        e[1].hash = sha256(
          [
            e[1].prev_hash,
            2,
            e[1].occurred_at,
            id,
            e[1].type,
            e[1].actor_id,
            e[1].body,
          ].join("\n"),
        );
      },
      3,
    ],
  ])("detects %s", (_case, tamper, brokenAt) => {
    const copy = structuredClone(events);
    tamper(copy);
    expect(verifyChain(id, copy, sha256)).toMatchObject({
      ok: false,
      brokenAt,
    });
  });
});
