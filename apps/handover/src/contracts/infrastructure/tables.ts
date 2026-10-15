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
  created_at: Timestamp;
  updated_at: Timestamp;
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
}
