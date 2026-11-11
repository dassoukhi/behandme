import type { EventPublisher } from "../../users/application/ports.js";
import type { KeyBackup } from "../domain/backup.js";
import type { KeyCare, PhraseLocation } from "../domain/care.js";
import type { RegisteredKeys } from "../domain/keys.js";
import type { KeyTransfer } from "../domain/transfer.js";

export interface KeyRepository {
  find(userId: string): Promise<RegisteredKeys | null>;
  /** The same, kept as they are until the transaction ends: a reset waits for it. */
  findForShare(userId: string): Promise<RegisteredKeys | null>;
  findMany(userIds: string[]): Promise<RegisteredKeys[]>;
  /** The user's keys of that version: the current ones, or retired ones from the history. */
  findVersion(
    userId: string,
    keyVersion: number,
  ): Promise<RegisteredKeys | null>;
  /** False when the user already has keys. */
  insert(keys: Omit<RegisteredKeys, "createdAt">): Promise<boolean>;
  /**
   * Replaces the keys of version `replacedVersion` by `keys`, and keeps the old ones in the history.
   * False when the registered keys are no longer that version (another reset won the race).
   */
  replace(
    replacedVersion: number,
    keys: RegisteredKeys,
    reason: "reset",
  ): Promise<boolean>;
  careOf(userIds: string[]): Promise<KeyCare[]>;
  /** The next page of everyone's key care, in user id order. */
  carePage(afterUserId: string | null, limit: number): Promise<KeyCare[]>;
  /** False when the registered keys are no longer that version. Never moves back in time. */
  recordProof(userId: string, keyVersion: number, day: Date): Promise<boolean>;
  /** At least one change. False when the registered keys are no longer that version. */
  updateCare(
    userId: string,
    keyVersion: number,
    change: {
      checkedAt?: Date;
      /** This check is one more step of the schedule, not the same one answered twice. */
      countCheck?: boolean;
      location?: PhraseLocation;
    },
  ): Promise<boolean>;
  markReminded(userIds: string[], at: Date): Promise<void>;
}
export const KEY_REPOSITORY = Symbol("KeyRepository");

/** core.key_transfers: a user's transfers, never another user's. */
export interface KeyTransferRepository {
  /** The user's only transfer: replaces the one they had, under a new id and with no wrap. */
  open(
    transfer: Omit<KeyTransfer, "id" | "wrap" | "createdAt">,
  ): Promise<KeyTransfer>;
  find(id: string, userId: string): Promise<KeyTransfer | null>;
  /** Locked until the transaction ends: one depositor, one taker. */
  findForUpdate(id: string, userId: string): Promise<KeyTransfer | null>;
  deposit(id: string, wrap: Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}
export const KEY_TRANSFER_REPOSITORY = Symbol("KeyTransferRepository");

/** core.key_backups: one backup per account. */
export interface KeyBackupRepository {
  find(userId: string): Promise<KeyBackup | null>;
  /** Replaces the user's backup. False when the one there was made later than this one. */
  put(backup: KeyBackup): Promise<boolean>;
  /** False when the user had no backup. */
  deleteForUser(userId: string): Promise<boolean>;
}
export const KEY_BACKUP_REPOSITORY = Symbol("KeyBackupRepository");

/** Keys and the events their change causes, in one transaction. */
export interface KeysTransaction {
  keys: KeyRepository;
  transfers: KeyTransferRepository;
  backups: KeyBackupRepository;
  events: EventPublisher;
}

export interface KeysUnitOfWork {
  run<T>(work: (tx: KeysTransaction) => Promise<T>): Promise<T>;
}
export const KEYS_UNIT_OF_WORK = Symbol("KeysUnitOfWork");

/** Who must hear that a user's keys changed, and how to name the user to them (users module). */
export interface KeyHolderDirectory {
  describe(
    userId: string,
  ): Promise<{ name: string | null; trusterIds: string[] }>;
}
export const KEY_HOLDER_DIRECTORY = Symbol("KeyHolderDirectory");

/** Milliseconds before others may use keys after a reset (domain/keys.ts, keyQuarantineMs). */
export const KEY_QUARANTINE = Symbol("KeyQuarantine");

/** The cryptography the server needs: it checks, it never encrypts or decrypts. */
export interface KeyCryptography {
  canonicalJson(value: unknown): Uint8Array;
  verifyEd25519(
    publicKey: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array,
  ): boolean;
  sha256Hex(bytes: Uint8Array): string;
  toBase64(bytes: Uint8Array): string;
}
export const KEY_CRYPTOGRAPHY = Symbol("KeyCryptography");
