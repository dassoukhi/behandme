import type { Executor, NewEvent } from "@lib/messaging";
import type { Claim, ClaimStatus, Decision } from "../domain/claims.js";
import type { AuditEntry } from "../domain/audit-events.js";
import type { SealCrypto } from "../domain/sealing.js";
import type { ChainEvent } from "../domain/audit-chain.js";
import type {
  Contract,
  ContractChanges,
  DraftInput,
  Status,
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
  /** Moves a contract from `from` to `to` (claims, release). Null when it is no longer `from`. */
  transition(id: string, from: Status, to: Status): Promise<Contract | null>;
}

export interface ClaimRepository {
  find(claimId: string): Promise<Claim | null>;
  /** The open claim of each of these contracts that has one. */
  openFor(contractIds: string[]): Promise<Claim[]>;
  /** The claim that released the contract. */
  released(contractId: string): Promise<Claim | null>;
  /** The last closed claim of `claimantId` on each of these contracts. */
  lastClosedBy(claimantId: string, contractIds: string[]): Promise<Claim[]>;
  insert(
    claim: Pick<
      Claim,
      | "contractId"
      | "claimantId"
      | "sealedVersion"
      | "filedAt"
      | "contestUntil"
      | "expiresAt"
    >,
  ): Promise<Claim>;
  /** False when the claim is no longer open. `at`: the service's clock, as for every deadline. */
  close(
    claimId: string,
    status: Exclude<ClaimStatus, "open">,
    closedBy: string | null,
    at: Date,
  ): Promise<boolean>;
  decisions(claimIds: string[]): Promise<Map<string, Decision[]>>;
  /** False when this validator already decided. */
  decide(claimId: string, decision: Decision): Promise<boolean>;
  /** A claim closed without release: the shares re-wrapped to the accessor are erased. */
  eraseReleaseWraps(claimId: string): Promise<void>;
  /** Open claims past their contest window or their expiry at `now`. */
  due(now: Date): Promise<Claim[]>;
}

/** Events for the other services (and delayed ones for handover itself), committed with the change. */
export interface EventPublisher {
  publish(event: NewEvent, options?: { deliverAt?: Date }): Promise<void>;
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
  /** The signed manifest (canonical JSON) of each of these contracts that is sealed. */
  manifests(contractIds: string[]): Promise<Map<string, string>>;
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
  claims: ClaimRepository;
  audit: AuditLog;
  events: EventPublisher;
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

/** Development only: replaces every contract's contest window, in milliseconds (null in production). */
export const CONTEST_OVERRIDE = Symbol("ContestOverride");
