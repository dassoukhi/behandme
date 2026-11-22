import { InvalidInputError } from "@lib/kernel";

export const CATEGORIES = [
  "networks",
  "devices",
  "storage",
  "finances",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** draft → (sealed, phase 4) active → (claim, phase 5) claimed → released; revoked from any but released. */
export const STATUSES = [
  "draft",
  "active",
  "claimed",
  "released",
  "revoked",
] as const;
export type Status = (typeof STATUSES)[number];

export type Role = "owner" | "accessor" | "validator";

export const MAX_VALIDATORS = 3;
export const MAX_DESCRIPTION = 280;
/** Days the owner has to cancel a claim, when they did not choose: time for an owner who is alive to say so. */
export const DEFAULT_CONTEST_DAYS = 15;
/** The days an owner may give themselves to cancel a claim: 3 days to 3 months. */
export const MIN_CONTEST_DAYS = 3;
export const MAX_CONTEST_DAYS = 90;

/**
 * Bank accounts and cryptocurrency, where a mistaken handover costs the most: at least 15 days to cancel, exactly 3
 * validators (2 approvals, never all: one lost key would lock the envelope for ever), and a handover after a death
 * only.
 */
export const FINANCES = { minContestDays: 15, validators: 3 } as const;

/** Why a claim is filed. "incapacity" says the owner can no longer act: health data, which needs their consent. */
export const CLAIM_REASONS = ["death", "incapacity"] as const;
export type ClaimReason = (typeof CLAIM_REASONS)[number];

/**
 * A claim saying the owner can no longer act has no doctor nor judge behind it, unlike a mandat de protection future
 * (art. 477 and 481 of the Code civil), and an owner in a coma cannot cancel it. So, after a digital-law jurist's
 * opinion: at least 2 validators, a longer window (twice the owner's, and at least 30 days), and a motivated
 * statement from whoever files it.
 */
export const INCAPACITY = {
  minValidators: 2,
  delayFactor: 2,
  minContestDays: 30,
  statement: { min: 20, max: 1000 },
} as const;

/** Why a participant left: they refused their role, or their account is gone. */
export type LeftReason = "declined" | "account_deleted";

/** A participant who left: they no longer see the contract, and are told nothing more about it. */
export interface Departure {
  userId: string;
  role: "accessor" | "validator";
  reason: LeftReason;
  /** ISO time. */
  at: string;
}

export interface Contract {
  id: string;
  ownerId: string;
  category: Category;
  /** Visible to every participant: never anything secret. */
  description: string | null;
  status: Status;
  /** Bumped by every change. */
  version: number;
  /** Number of the current sealing; 0 while never sealed. */
  sealedVersion: number;
  /** Days the owner has to cancel a claim. */
  contestDays: number;
  /**
   * The owner's explicit consent to a claim saying they can no longer act (GDPR art. 9); without it, the contract is
   * handed over only after a death. Never for finances.
   */
  incapacityAllowed: boolean;
  accessorId: string;
  validatorIds: string[];
  /**
   * Those of `accessorId` and `validatorIds` who left. They stay named: their share or their access goes
   * unused until the owner seals again, which starts with no departure.
   */
  departures: Departure[];
  createdAt: string;
  updatedAt: string;
}

export interface DraftInput {
  category: Category;
  description: string | null;
  accessorId: string;
  validatorIds: string[];
  /** DEFAULT_CONTEST_DAYS when left out. */
  contestDays?: number;
  /** False when left out. */
  incapacityAllowed?: boolean;
}

export interface ContractChanges {
  category?: Category;
  description?: string | null;
  contestDays?: number;
  incapacityAllowed?: boolean;
}

/**
 * A draft names one accessor and 1 to 3 validators, all distinct, and none of them the owner. That
 * they are people the owner trusts is checked by the gateway, which owns trust links.
 */
export function assertValidDraft(ownerId: string, input: DraftInput): void {
  assertValidFields(input);
  const { accessorId, validatorIds } = input;
  if (!accessorId) throw new InvalidInputError("An accessor is required");
  if (validatorIds.length < 1 || validatorIds.length > MAX_VALIDATORS) {
    throw new InvalidInputError(
      `A contract needs 1 to ${MAX_VALIDATORS} validators`,
    );
  }
  if (validatorIds.some((id) => !id)) {
    throw new InvalidInputError("A validator id is empty");
  }
  if (new Set(validatorIds).size !== validatorIds.length) {
    throw new InvalidInputError("Validators must be distinct");
  }
  if (accessorId === ownerId || validatorIds.includes(ownerId)) {
    throw new InvalidInputError(
      "You cannot be the accessor or a validator of your own contract",
    );
  }
  if (validatorIds.includes(accessorId)) {
    throw new InvalidInputError("The accessor cannot also be a validator");
  }
  assertCategoryRules({
    category: input.category,
    contestDays: input.contestDays ?? DEFAULT_CONTEST_DAYS,
    incapacityAllowed: input.incapacityAllowed ?? false,
    validatorCount: validatorIds.length,
  });
}

/**
 * What a category asks of the whole contract, as it is or would be after a change (creation, edit, sealing):
 * finances waits 15 days or more, has exactly 3 validators, and allows no claim for an incapacity; a claim for an
 * incapacity needs at least 2 validators. `validatorCount` left out: a draft's validators, which its sealing replaces
 * and checks.
 */
export function assertCategoryRules(contract: {
  category: Category;
  contestDays: number;
  incapacityAllowed: boolean;
  validatorCount?: number;
}): void {
  if (
    contract.incapacityAllowed &&
    contract.validatorCount !== undefined &&
    contract.validatorCount < INCAPACITY.minValidators
  ) {
    throw new InvalidInputError(
      `A claim for an incapacity needs at least ${INCAPACITY.minValidators} validators`,
    );
  }
  if (contract.category !== "finances") return;
  if (contract.contestDays < FINANCES.minContestDays) {
    throw new InvalidInputError(
      `A finances contract waits at least ${FINANCES.minContestDays} days`,
    );
  }
  if (
    contract.validatorCount !== undefined &&
    contract.validatorCount !== FINANCES.validators
  ) {
    throw new InvalidInputError(
      `A finances contract needs exactly ${FINANCES.validators} validators`,
    );
  }
  if (contract.incapacityAllowed) {
    throw new InvalidInputError(
      "A finances contract is handed over only after a death",
    );
  }
}

/**
 * The reasons a claim may give: a death always; an incapacity only with the owner's consent, never for finances, and
 * while at least 2 validators remain.
 */
export function claimReasons(
  contract: Pick<
    Contract,
    "category" | "incapacityAllowed" | "validatorIds" | "departures"
  >,
): ClaimReason[] {
  const present = contract.validatorIds.filter(
    (id) => !hasLeft(contract, id),
  ).length;
  return contract.incapacityAllowed &&
    contract.category !== "finances" &&
    present >= INCAPACITY.minValidators
    ? ["death", "incapacity"]
    : ["death"];
}

/** Days the owner has to cancel a claim with this reason: twice theirs, and at least 30, for an incapacity. */
export function claimContestDays(
  contract: Pick<Contract, "contestDays">,
  reason: ClaimReason,
): number {
  return reason === "incapacity"
    ? Math.max(
        contract.contestDays * INCAPACITY.delayFactor,
        INCAPACITY.minContestDays,
      )
    : contract.contestDays;
}

/**
 * A claim for an incapacity says why, in 20 to 1,000 characters (trimmed); a claim for a death says nothing more, as
 * nothing more is needed. Returns what to keep.
 */
export function claimStatement(
  reason: ClaimReason,
  statement: string | undefined,
): string | null {
  const text = statement?.trim() ?? "";
  if (reason === "death") {
    if (text) {
      throw new InvalidInputError("A claim for a death takes no statement");
    }
    return null;
  }
  const { min, max } = INCAPACITY.statement;
  if (text.length < min || text.length > max) {
    throw new InvalidInputError(
      `A claim for an incapacity needs a statement of ${min} to ${max} characters`,
    );
  }
  return text;
}

export function assertValidFields(fields: ContractChanges): void {
  if (fields.category !== undefined && !CATEGORIES.includes(fields.category)) {
    throw new InvalidInputError(`Unknown category ${fields.category}`);
  }
  if ((fields.description?.length ?? 0) > MAX_DESCRIPTION) {
    throw new InvalidInputError(
      `The description is longer than ${MAX_DESCRIPTION} characters`,
    );
  }
  const days = fields.contestDays;
  if (
    days !== undefined &&
    (!Number.isInteger(days) ||
      days < MIN_CONTEST_DAYS ||
      days > MAX_CONTEST_DAYS)
  ) {
    throw new InvalidInputError(
      `contest_days must be ${MIN_CONTEST_DAYS} to ${MAX_CONTEST_DAYS}`,
    );
  }
}

/** The user's role on the contract, or null when it is none of theirs, or no longer is: they left. */
export function roleOf(contract: Contract, userId: string): Role | null {
  if (contract.ownerId === userId) return "owner";
  if (hasLeft(contract, userId)) return null;
  if (contract.accessorId === userId) return "accessor";
  if (contract.validatorIds.includes(userId)) return "validator";
  return null;
}

export function hasLeft(
  contract: { departures: { userId: string }[] },
  userId: string,
): boolean {
  return contract.departures.some((d) => d.userId === userId);
}

/** The participants who have not left: those who are still told about the contract. */
export function presentParticipants(contract: Contract): {
  accessorId: string | null;
  validatorIds: string[];
} {
  return {
    accessorId: hasLeft(contract, contract.accessorId)
      ? null
      : contract.accessorId,
    validatorIds: contract.validatorIds.filter((id) => !hasLeft(contract, id)),
  };
}

/** The fields `changes` actually changes on `contract`. */
export function changedFields(
  contract: Contract,
  changes: ContractChanges,
): (keyof ContractChanges)[] {
  return (Object.keys(changes) as (keyof ContractChanges)[]).filter(
    (field) =>
      changes[field] !== undefined && changes[field] !== contract[field],
  );
}
