import type { RegisteredKeys } from "../domain/keys.js";

export interface KeyRepository {
  find(userId: string): Promise<RegisteredKeys | null>;
  findMany(userIds: string[]): Promise<RegisteredKeys[]>;
  /** False when the user already has keys. */
  insert(keys: Omit<RegisteredKeys, "createdAt">): Promise<boolean>;
}
export const KEY_REPOSITORY = Symbol("KeyRepository");

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
