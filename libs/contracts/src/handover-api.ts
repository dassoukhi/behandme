// Internal HTTP API of the handover service, called by the gateway with an internal token whose
// subject is the user the request is for (libs/platform, internal-token.ts).

export const HANDOVER_AUDIENCE = "handover";

export const CONTRACT_CATEGORIES = ["networks", "devices", "storage"] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

export const CONTRACT_STATUSES = [
  "draft",
  "active",
  "claimed",
  "released",
  "revoked",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type ContractRole = "owner" | "accessor" | "validator";

/** What the user may do on the contract now; the app shows only these actions. */
export type ContractAction = "update" | "delete";

/** A contract as one of its participants sees it. */
export interface ContractRecord {
  id: string;
  owner_id: string;
  category: ContractCategory;
  description: string | null;
  status: ContractStatus;
  /** Bumped by every change. */
  version: number;
  accessor_id: string;
  /** In order. */
  validator_ids: string[];
  created_at: string;
  updated_at: string;
  my_role: ContractRole;
  allowed_actions: ContractAction[];
}

export interface NewContract {
  category: ContractCategory;
  description?: string | null;
  accessor_id: string;
  validator_ids: string[];
}

export interface ContractChanges {
  category?: ContractCategory;
  description?: string | null;
}

/** One entry of a contract's audit log, with what is needed to check its hash. */
export interface AuditEvent {
  seq: number;
  type: string;
  /** Clerk id of who did it; null for the system. */
  actor_id: string | null;
  /** Canonical JSON (RFC 8785), exactly as hashed. */
  body: string;
  /** ISO 8601 with milliseconds, exactly as hashed. */
  occurred_at: string;
  prev_hash: string;
  hash: string;
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  /** Hash of the last event; null when the log is empty. */
  head_hash: string | null;
  /** First seq that does not verify; null when ok. */
  broken_at: number | null;
}
