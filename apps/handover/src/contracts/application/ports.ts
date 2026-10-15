import type { Executor } from "@lib/messaging";
import type { AuditEntry } from "../domain/audit-events.js";
import type { SealCrypto } from "../domain/sealing.js";
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
  /**
   * Records a new sealing: participants replaced, status active, sealed_version set. Null when the
   * version is no longer `expectedVersion`.
   */
  markSealed(
    id: string,
    sealing: {
      sealedVersion: number;
      accessorId: string;
      validatorIds: string[];
    },
    expectedVersion: number,
  ): Promise<Contract | null>;
  markRevoked(id: string, expectedVersion: number): Promise<Contract | null>;
}

/** The current sealing of a contract (handover.envelopes and key_wraps). */
export interface Sealing {
  sealedVersion: number;
  envelope: Uint8Array;
  envelopeHash: string;
  manifestText: string;
  manifestSignature: Uint8Array;
  ownerWrap: Uint8Array;
  ownerKeyVersion: number;
  shares: {
    userId: string;
    index: number;
    keyVersion: number;
    wrap: Uint8Array;
  }[];
}

export interface SealingRepository {
  find(contractId: string): Promise<Sealing | null>;
  /** Replaces the previous sealing, if any. */
  replace(contractId: string, sealing: Sealing): Promise<void>;
  delete(contractId: string): Promise<void>;
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
  sealings: SealingRepository;
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

export const SEAL_CRYPTO = Symbol("SealCrypto");
export type { SealCrypto };

export const CLOCK = Symbol("Clock");
