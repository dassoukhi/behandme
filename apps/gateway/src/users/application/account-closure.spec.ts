import { describe, expect, it } from "vitest";
import type { ContractRecord } from "@lib/contracts";
import { closureSummary, describeClosure } from "./account-closure.js";

const record = (
  my_role: ContractRecord["my_role"],
  status: ContractRecord["status"],
) => ({ my_role, status }) as ContractRecord;

describe("what closing an account does to its envelopes", () => {
  it("counts what handover will delete, revoke, leave, and tell the owners about", () => {
    const summary = closureSummary([
      record("owner", "draft"),
      record("owner", "active"),
      record("owner", "claimed"),
      record("owner", "released"),
      record("owner", "revoked"),
      record("accessor", "active"),
      record("validator", "claimed"),
      record("validator", "released"),
      record("accessor", "revoked"),
    ]);
    expect(summary).toEqual({
      drafts: 1,
      revoked: 2,
      claimsInProgress: 1,
      handedOver: 1,
      participations: 2,
    });
  });

  it("is what support reads before telling the heirs, without the envelopes' content", () => {
    const lines = describeClosure(
      {
        id: "user_1",
        email: "nina@example.com",
        first_name: "Nina",
        last_name: "Martin",
      },
      {
        drafts: 0,
        revoked: 2,
        claimsInProgress: 1,
        handedOver: 1,
        participations: 3,
      },
    );
    expect(lines[0]).toBe("Account user_1: Nina Martin <nina@example.com>");
    expect(lines[1]).toBe(
      "- 2 envelope(s) of theirs not handed over yet: revoked, nobody will ever open them (1 with a handover request in progress)",
    );
    expect(lines).toContain(
      "- 3 envelope(s) of other people where they are the recipient or a validator: the owners are told",
    );
  });
});
