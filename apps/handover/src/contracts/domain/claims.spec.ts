import { describe, expect, it } from "vitest";
import { ConflictError, InvalidInputError } from "@lib/kernel";
import {
  assertApproval,
  CLAIM_COOLDOWN_MS,
  claimDeadlines,
  contestOverrideMs,
  cooldownUntil,
  type Decision,
  settlement,
  tally,
} from "./claims.js";

const NOW = new Date("2026-10-16T09:00:00Z");
const approve = (validatorId: string): Decision => ({
  validatorId,
  approve: true,
  shareIndex: 1,
  accessorKeyVersion: 1,
  releaseWrap: new Uint8Array(1170),
});
const reject = (validatorId: string): Decision => ({
  validatorId,
  approve: false,
  shareIndex: null,
  accessorKeyVersion: null,
  releaseWrap: null,
});

describe("claim deadlines", () => {
  it("gives the owner the contract's contest window, and 60 days before expiry", () => {
    const { contestUntil, expiresAt } = claimDeadlines(
      { contestDays: 7 },
      NOW,
      null,
    );
    expect(contestUntil.toISOString()).toBe("2026-10-23T09:00:00.000Z");
    expect(expiresAt.toISOString()).toBe("2026-12-15T09:00:00.000Z");
  });

  it("is shortened only by the development override, refused in production", () => {
    expect(contestOverrideMs(undefined, "production")).toBeNull();
    expect(contestOverrideMs("60", "development")).toBe(60_000);
    expect(() => contestOverrideMs("60", "production")).toThrow(
      "refused in production",
    );
    expect(() => contestOverrideMs("-1", "development")).toThrow();
    expect(
      claimDeadlines(
        { contestDays: 7 },
        NOW,
        60_000,
      ).contestUntil.toISOString(),
    ).toBe("2026-10-16T09:01:00.000Z");
  });
});

describe("cooldown", () => {
  it("applies 72 hours after the owner cancelled the claimant's claim, and only then", () => {
    const closedAt = new Date(NOW.getTime() - 3_600_000);
    expect(cooldownUntil({ status: "cancelled", closedAt }, NOW)).toEqual(
      new Date(closedAt.getTime() + CLAIM_COOLDOWN_MS),
    );
    expect(cooldownUntil({ status: "withdrawn", closedAt }, NOW)).toBeNull();
    expect(
      cooldownUntil(
        {
          status: "cancelled",
          closedAt: new Date(NOW.getTime() - CLAIM_COOLDOWN_MS),
        },
        NOW,
      ),
    ).toBeNull();
    expect(cooldownUntil(null, NOW)).toBeNull();
  });
});

describe("tally and settlement", () => {
  it.each<[string, Decision[], number, Partial<ReturnType<typeof tally>>]>([
    [
      "k = 2 of 3 approvals",
      [approve("a"), approve("b")],
      3,
      { quorum: true, rejected: false },
    ],
    [
      "two rejections of 3: k is out of reach",
      [reject("a"), reject("b")],
      3,
      { quorum: false, rejected: true },
    ],
    [
      "one rejection of 3 still leaves k",
      [reject("a"), approve("b")],
      3,
      { quorum: false, rejected: false },
    ],
    [
      "2 of 2 needed: one rejection is enough",
      [reject("a")],
      2,
      { rejected: true },
    ],
    ["1 of 1", [approve("a")], 1, { quorum: true, threshold: 1 }],
  ])("%s", (_case, decisions, n, expected) => {
    expect(tally(decisions, n)).toMatchObject(expected);
  });

  it("releases only with the quorum and after the contest window; expires after 60 days", () => {
    const claim = {
      contestUntil: new Date("2026-10-23T09:00:00Z"),
      expiresAt: new Date("2026-12-15T09:00:00Z"),
    };
    const quorum = tally([approve("a"), approve("b")], 3);
    const none = tally([approve("a")], 3);
    expect(settlement(claim, quorum, NOW)).toBe("wait");
    expect(settlement(claim, quorum, claim.contestUntil)).toBe("release");
    expect(settlement(claim, none, claim.contestUntil)).toBe("wait");
    expect(settlement(claim, none, claim.expiresAt)).toBe("expire");
  });
});

describe("approval", () => {
  const accessorKey = {
    keyVersion: 2,
    fingerprint: "f".repeat(64),
    signingPublicKey: new Uint8Array(32),
    usableFrom: new Date("2026-10-01T00:00:00Z"),
  };
  const wrap = () => {
    const bytes = new Uint8Array(1170);
    bytes[0] = 1;
    return bytes;
  };

  it("accepts a share re-wrapped to the accessor's current, usable keys", () => {
    expect(() =>
      assertApproval(
        { releaseWrap: wrap(), accessorKeyVersion: 2 },
        3,
        accessorKey,
        NOW,
      ),
    ).not.toThrow();
  });

  it.each<
    [string, () => void, typeof InvalidInputError | typeof ConflictError]
  >([
    [
      "a wrap of the wrong size",
      () =>
        assertApproval(
          { releaseWrap: new Uint8Array(1169), accessorKeyVersion: 2 },
          3,
          accessorKey,
          NOW,
        ),
      InvalidInputError,
    ],
    [
      "an accessor without keys",
      () =>
        assertApproval(
          { releaseWrap: wrap(), accessorKeyVersion: 2 },
          3,
          undefined,
          NOW,
        ),
      InvalidInputError,
    ],
    [
      "old accessor keys",
      () =>
        assertApproval(
          { releaseWrap: wrap(), accessorKeyVersion: 1 },
          3,
          accessorKey,
          NOW,
        ),
      ConflictError,
    ],
    [
      "accessor keys in quarantine",
      () =>
        assertApproval(
          { releaseWrap: wrap(), accessorKeyVersion: 2 },
          3,
          { ...accessorKey, usableFrom: new Date("2026-10-18T00:00:00Z") },
          NOW,
        ),
      ConflictError,
    ],
  ])("refuses %s", (_case, act, error) => {
    expect(act).toThrow(error);
  });
});
