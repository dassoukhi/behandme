import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConflictError, InvalidInputError, NotFoundError } from "@lib/kernel";
import fixture from "../testing/chain-v1.json" with { type: "json" };
import { type ChainEvent, verifyChain } from "./audit-chain.js";
import { contractCreated, contractUpdated } from "./audit-events.js";
import {
  assertValidDraft,
  changedFields,
  type Contract,
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
  accessorId: "acc",
  validatorIds: ["v1", "v2"],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};
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

  it("gives each user their role, or none", () => {
    expect(roleOf(draft, "owner")).toBe("owner");
    expect(roleOf(draft, "acc")).toBe("accessor");
    expect(roleOf(draft, "v2")).toBe("validator");
    expect(roleOf(draft, "stranger")).toBeNull();
  });

  it("lists only the fields a change really changes", () => {
    expect(
      changedFields(draft, { category: "networks", description: "Autre" }),
    ).toEqual(["description"]);
    expect(changedFields(draft, { description: undefined })).toEqual([]);
  });
});

describe("life cycle", () => {
  it("lets the owner edit and delete a draft, and nobody else", () => {
    expect(allowedActions(draft, "owner")).toEqual(["update", "delete"]);
    expect(allowedActions(draft, "accessor")).toEqual([]);
    expect(allowedActions(draft, "validator")).toEqual([]);
  });

  it("only lets the owner edit an active contract", () => {
    expect(allowedActions({ ...draft, status: "active" }, "owner")).toEqual([
      "update",
    ]);
  });

  it("leaves no action on a released or revoked contract", () => {
    for (const status of ["released", "revoked"] as const) {
      expect(allowedActions({ ...draft, status }, "owner")).toEqual([]);
    }
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
