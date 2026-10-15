import type { EventPublisher } from "../../users/application/ports.js";
import type { RegisteredKeys } from "../domain/keys.js";

export interface KeyRepository {
  find(userId: string): Promise<RegisteredKeys | null>;
  findMany(userIds: string[]): Promise<RegisteredKeys[]>;
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
