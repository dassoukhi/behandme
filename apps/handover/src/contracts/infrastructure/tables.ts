import type { ColumnType, Generated } from "kysely";

// Schema handover (supabase/migrations/20261014220000_handover_and_audit_log.sql).

type Timestamp = ColumnType<Date, Date | undefined, Date>;

export interface ContractsTable {
  id: Generated<string>;
  owner_id: string;
  category: string;
  description: string | null;
  status: ColumnType<string, string | undefined, string>;
  version: ColumnType<number, number | undefined, number>;
  sealed_version: ColumnType<number, number | undefined, number>;
  sealed_at: Date | null;
  revoked_at: Date | null;
  contest_days: ColumnType<number, number | undefined, number>;
  /** 20261122120000_transmission_rules.sql. */
  incapacity_allowed: ColumnType<boolean, boolean | undefined, boolean>;
  released_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ClaimsTable {
  id: Generated<string>;
  contract_id: string;
  claimant_id: string;
  /** Null for a claim filed before reasons were asked (20261122120000_transmission_rules.sql). */
  reason: ColumnType<
    "death" | "incapacity" | null,
    "death" | "incapacity",
    never
  >;
  sealed_version: number;
  status: ColumnType<string, string | undefined, string>;
  filed_at: Timestamp;
  contest_until: Date;
  expires_at: Date;
  closed_at: Date | null;
  closed_by: string | null;
}

export interface DecisionsTable {
  claim_id: string;
  validator_id: string;
  approve: boolean;
  decided_at: Timestamp;
  share_index: number | null;
  accessor_key_version: number | null;
  release_wrap: Uint8Array | null;
}

export interface EnvelopesTable {
  contract_id: string;
  sealed_version: number;
  envelope: Uint8Array;
  envelope_hash: string;
  manifest: string;
  manifest_signature: Uint8Array;
  owner_wrap: Uint8Array;
  owner_key_version: number;
  sealed_at: ColumnType<Date, Date | undefined, Date>;
}

export interface KeyWrapsTable {
  contract_id: string;
  share_index: number;
  user_id: string;
  key_version: number;
  wrap: Uint8Array;
}

export interface ParticipantsTable {
  contract_id: string;
  user_id: string;
  role: "accessor" | "validator";
  position: number;
  /** Set when they left (20261121120000_participants_left.sql); a participant is added present. */
  left_at: ColumnType<Date | null, never, Date | null>;
  left_reason: ColumnType<
    "declined" | "account_deleted" | null,
    never,
    "declined" | "account_deleted" | null
  >;
}

/** Read-only for svc_handover: rows are added by handover.append_event. */
export interface ContractEventsTable {
  id: Generated<string>;
  contract_id: string;
  seq: number;
  type: string;
  actor_id: string | null;
  body: string;
  occurred_at: string;
  prev_hash: string;
  hash: string;
}

export interface HandoverDatabase {
  contracts: ContractsTable;
  participants: ParticipantsTable;
  contract_events: ContractEventsTable;
  envelopes: EnvelopesTable;
  key_wraps: KeyWrapsTable;
  claims: ClaimsTable;
  decisions: DecisionsTable;
}
