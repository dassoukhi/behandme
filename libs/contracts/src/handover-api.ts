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
export type ContractAction = "update" | "delete" | "seal" | "revoke";

/** A contract as one of its participants sees it. */
export interface ContractRecord {
  id: string;
  owner_id: string;
  category: ContractCategory;
  description: string | null;
  status: ContractStatus;
  /** Bumped by every change. */
  version: number;
  /** Number of the current sealing (0 while a draft). */
  sealed_version: number;
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

/** A user's current public keys, as the gateway (which owns them) passes them to handover. */
export interface RegisteredKeyRecord {
  user_id: string;
  key_version: number;
  fingerprint: string;
  /** Ed25519, base64. */
  signing_public_key: string;
  usable_from: string;
}

/** Sealed material made on the owner's phone (the app's docs/crypto-protocol.md, "Sealing"). Base64. */
export interface SealRequestBody {
  /** The contract version the owner saw. */
  expected_version: number;
  accessor_id: string;
  validator_ids: string[];
  envelope: string;
  owner_wrap: string;
  shares: {
    user_id: string;
    index: number;
    key_version: number;
    wrap: string;
  }[];
  /** Exactly the object the owner signed (the server checks the signature over its RFC 8785 JSON). */
  manifest: Record<string, unknown>;
  manifest_signature: string;
}

/** What one participant may download of a sealed contract. Base64. */
export interface SealedMaterial {
  sealed_version: number;
  manifest: Record<string, unknown>;
  manifest_signature: string;
  /** Owner only. */
  envelope?: string;
  /** Owner only: the contract key wrapped to them. */
  owner_wrap?: string;
  /** Validator only: their share, wrapped to them. */
  share?: { index: number; key_version: number; wrap: string };
}
