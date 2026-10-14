import type { Executor } from "@lib/messaging";
import type { AuditEntry } from "../domain/audit-events.js";
import type { ChainEvent } from "../domain/audit-chain.js";
import type {
  Contract,
  ContractChanges,
  DraftInput,
} from "../domain/contract.js";

export interface ContractRepository {
  find(id: string): Promise<Contract | null>;
  /** Contracts the user owns or takes part in, newest first. */
  listFor(userId: string): Promise<Contract[]>;
  insert(ownerId: string, input: DraftInput): Promise<Contract>;
  /** Null when the contract is gone or its version is no longer `expectedVersion`. */
  update(
    id: string,
    changes: ContractChanges,
    expectedVersion: number,
  ): Promise<Contract | null>;
  delete(id: string): Promise<void>;
  draftsOwnedBy(userId: string): Promise<Contract[]>;
}

export interface AuditLog {
  /** Adds the next event of the contract's chain, in the current transaction. */
  append(
    contractId: string,
    actorId: string | null,
    entry: AuditEntry,
  ): Promise<void>;
  /** The contract's events in order. */
  list(contractId: string): Promise<ChainEvent[]>;
  /** Every contract that has a log, deleted drafts included. */
  contractIds(): Promise<string[]>;
}

/** Handover's repositories, bound to one connection or transaction. */
export interface HandoverStore {
  contracts: ContractRepository;
  audit: AuditLog;
}

export interface HandoverStores {
  /** On the service's pool, outside any transaction. */
  root: HandoverStore;
  /** Bound to `tx`, e.g. the transaction of a message being handled. */
  bind(tx: Executor): HandoverStore;
  /** Runs `work` in a new transaction: a change and its audit event commit together. */
  transaction<T>(work: (store: HandoverStore) => Promise<T>): Promise<T>;
}
export const HANDOVER_STORES = Symbol("HandoverStores");

/** Lowercase hex SHA-256 of a UTF-8 string. */
export type Sha256Hex = (text: string) => string;
export const SHA256 = Symbol("Sha256");
