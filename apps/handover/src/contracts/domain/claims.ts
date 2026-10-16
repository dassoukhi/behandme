import { ConflictError, InvalidInputError } from "@lib/kernel";
import type { Contract } from "./contract.js";
import type { RegisteredKey } from "./sealing.js";
import { isShareWrap, threshold } from "./sealing.js";

// Claims (docs/architecture.md, "Contract life cycle"): an accessor or a validator asks for the release;
// the owner may cancel during the contest window; validators approve (re-wrapping their share to the
// accessor) or reject; the contract is released once k approved and the window is over.

export type ClaimStatus =
  "open" | "cancelled" | "withdrawn" | "rejected" | "expired" | "released";

/** After the owner cancelled their claim, a claimant waits this long before claiming again. */
export const CLAIM_COOLDOWN_MS = 72 * 3_600_000;
/** An open claim that never gathers its quorum ends after this. */
export const CLAIM_EXPIRY_MS = 60 * 86_400_000;
const DAY_MS = 86_400_000;

export interface Claim {
  id: string;
  contractId: string;
  claimantId: string;
  sealedVersion: number;
  status: ClaimStatus;
  filedAt: Date;
  contestUntil: Date;
  expiresAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
}

export interface Decision {
  validatorId: string;
  approve: boolean;
  shareIndex: number | null;
  accessorKeyVersion: number | null;
  releaseWrap: Uint8Array | null;
}

/**
 * The deadlines of a claim filed `now`. `contestOverrideMs` (development only) replaces the contract's
 * contest window, to test a release without waiting days.
 */
export function claimDeadlines(
  contract: Pick<Contract, "contestDays">,
  now: Date,
  contestOverrideMs: number | null,
): { contestUntil: Date; expiresAt: Date } {
  const contest = contestOverrideMs ?? contract.contestDays * DAY_MS;
  return {
    contestUntil: new Date(now.getTime() + contest),
    expiresAt: new Date(now.getTime() + Math.max(contest, CLAIM_EXPIRY_MS)),
  };
}

/**
 * When to remind the owner and the validators who have not decided: a day before the end of the contest
 * window, or halfway through a window shorter than two days.
 */
export function reminderAt(
  claim: Pick<Claim, "filedAt" | "contestUntil">,
): Date {
  const window = claim.contestUntil.getTime() - claim.filedAt.getTime();
  const before = window >= 2 * DAY_MS ? DAY_MS : window / 2;
  return new Date(claim.contestUntil.getTime() - before);
}

/** Until when `claimant` may not claim again after the owner cancelled their last claim; null if free. */
export function cooldownUntil(
  lastOfClaimant: Pick<Claim, "status" | "closedAt"> | null,
  now: Date,
): Date | null {
  if (lastOfClaimant?.status !== "cancelled" || !lastOfClaimant.closedAt)
    return null;
  const until = new Date(lastOfClaimant.closedAt.getTime() + CLAIM_COOLDOWN_MS);
  return until > now ? until : null;
}

export interface Tally {
  approvals: number;
  rejections: number;
  threshold: number;
  /** Enough approvals for a release (it still waits for the contest window). */
  quorum: boolean;
  /** Too many rejections: k approvals are no longer possible. */
  rejected: boolean;
}

export function tally(decisions: Decision[], validators: number): Tally {
  const k = threshold(validators);
  const approvals = decisions.filter((d) => d.approve).length;
  const rejections = decisions.length - approvals;
  return {
    approvals,
    rejections,
    threshold: k,
    quorum: approvals >= k,
    rejected: rejections > validators - k,
  };
}

/** What happens to an open claim at `now`, given its decisions. */
export function settlement(
  claim: Pick<Claim, "contestUntil" | "expiresAt">,
  result: Tally,
  now: Date,
): "release" | "expire" | "wait" {
  if (result.quorum && now >= claim.contestUntil) return "release";
  if (now >= claim.expiresAt) return "expire";
  return "wait";
}

/**
 * An approval: the validator's share, re-wrapped to the accessor's current registered keys, which must
 * be out of quarantine. The server cannot open the wrap; the accessor's phone checks it against the
 * owner's signed commitment (the app's lib/crypto/release.ts).
 */
export function assertApproval(
  approval: { releaseWrap: Uint8Array; accessorKeyVersion: number },
  validators: number,
  accessorKey: RegisteredKey | undefined,
  now: Date,
): void {
  if (!isShareWrap(approval.releaseWrap, validators)) {
    throw new InvalidInputError("The re-wrapped share is malformed");
  }
  if (!accessorKey) {
    throw new InvalidInputError("The accessor has no registered keys");
  }
  if (approval.accessorKeyVersion !== accessorKey.keyVersion) {
    throw new ConflictError(
      "The accessor's keys changed: wrap the share to their current keys",
    );
  }
  if (accessorKey.usableFrom > now) {
    throw new ConflictError(
      "The accessor's keys are not usable yet (recent reset)",
    );
  }
}

/**
 * CLAIM_CONTEST_SECONDS_OVERRIDE replaces every contest window, to test a release without waiting days:
 * refused in production, where the window is what lets an owner who is alive say so.
 */
export function contestOverrideMs(
  override: string | undefined,
  nodeEnv: string | undefined,
): number | null {
  if (override === undefined || override === "") return null;
  if (nodeEnv === "production") {
    throw new Error("CLAIM_CONTEST_SECONDS_OVERRIDE is refused in production");
  }
  const seconds = Number(override);
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error(
      "CLAIM_CONTEST_SECONDS_OVERRIDE must be a whole number of seconds",
    );
  }
  return seconds * 1000;
}
