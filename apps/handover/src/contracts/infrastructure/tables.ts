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
  created_at: Timestamp;
  updated_at: Timestamp;
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
}
