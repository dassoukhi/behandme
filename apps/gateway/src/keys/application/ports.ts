import type { EventPublisher } from "../../users/application/ports.js";
import type { KeyCare, PhraseLocation } from "../domain/care.js";
import type { RegisteredKeys } from "../domain/keys.js";

export interface KeyRepository {
  find(userId: string): Promise<RegisteredKeys | null>;
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

/** Keys and the events their change causes, in one transaction. */
export interface KeysTransaction {
  keys: KeyRepository;
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
