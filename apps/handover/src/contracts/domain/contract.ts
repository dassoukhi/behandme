import { InvalidInputError } from "@lib/kernel";

export const CATEGORIES = ["networks", "devices", "storage"] as const;
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
  accessorId: string;
  validatorIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DraftInput {
  category: Category;
  description: string | null;
  accessorId: string;
  validatorIds: string[];
}

export interface ContractChanges {
  category?: Category;
  description?: string | null;
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
}

/** The user's role on the contract, or null when it is none of theirs. */
export function roleOf(contract: Contract, userId: string): Role | null {
  if (contract.ownerId === userId) return "owner";
  if (contract.accessorId === userId) return "accessor";
  if (contract.validatorIds.includes(userId)) return "validator";
  return null;
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
