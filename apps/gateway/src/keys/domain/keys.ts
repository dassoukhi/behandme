import { InvalidInputError } from "@lib/kernel";

export {
  type FactorVerificationAge,
  recentlyVerified,
  RESET_REVERIFICATION,
  ReverificationRequired,
} from "../../auth/domain/reverification.js";

// Public end-to-end keys (the app's docs/crypto-protocol.md, "Identity keys"). The server stores them and
// checks that the user signed them; it never sees a private key.

export const KEM_PUBLIC_KEY_LENGTH = 1216; // X-Wing
export const SIGNING_PUBLIC_KEY_LENGTH = 32; // Ed25519
export const SIGNATURE_LENGTH = 64;

export interface RegisteredKeys {
  userId: string;
  keyVersion: number;
  kemPublicKey: Uint8Array;
  signingPublicKey: Uint8Array;
  fingerprint: string;
  signature: Uint8Array;
  usableFrom: Date;
  createdAt: Date;
}

export interface KeySubmission {
  keyVersion: number;
  kemPublicKey: Uint8Array;
  signingPublicKey: Uint8Array;
  signature: Uint8Array;
}

/** Sizes only; the signature is checked against the statement below. */
export function assertWellFormed(submission: KeySubmission): void {
  if (submission.kemPublicKey.length !== KEM_PUBLIC_KEY_LENGTH) {
    throw new InvalidInputError(
      "kem_public_key must be an X-Wing public key (1216 bytes)",
    );
  }
  if (submission.signingPublicKey.length !== SIGNING_PUBLIC_KEY_LENGTH) {
    throw new InvalidInputError(
      "signing_public_key must be an Ed25519 public key (32 bytes)",
    );
  }
  if (submission.signature.length !== SIGNATURE_LENGTH) {
    throw new InvalidInputError(
      "signature must be an Ed25519 signature (64 bytes)",
    );
  }
}

/** What the user signs (canonical JSON, RFC 8785): binds the keys to the account and the version. */
export function registrationStatement(
  userId: string,
  keyVersion: number,
  kemPublicKeyBase64: string,
  signingPublicKeyBase64: string,
) {
  return {
    type: "behindme/v1/key-registration",
    user_id: userId,
    key_version: keyVersion,
    kem_public_key: kemPublicKeyBase64,
    signing_public_key: signingPublicKeyBase64,
  };
}

/** Each part prefixed by its 4-byte big-endian length; SHA-256 of it is the fingerprint. */
export function fingerprintInput(
  kemPublicKey: Uint8Array,
  signingPublicKey: Uint8Array,
): Uint8Array {
  const parts = [
    new TextEncoder().encode("behindme/v1/fingerprint"),
    kemPublicKey,
    signingPublicKey,
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    new DataView(out.buffer).setUint32(offset, part.length);
    out.set(part, offset + 4);
    offset += 4 + part.length;
  }
  return out;
}

// --- Reset ----------------------------------------------------------------------------------------

/**
 * New keys after a reset are usable by others only after this delay: whoever reset them may not be the
 * account's owner (stolen session), who is alerted and has this long to react.
 */
export const KEY_QUARANTINE_MS = 72 * 3_600_000;

/**
 * The quarantine, from KEY_QUARANTINE_SECONDS_OVERRIDE (to test resets without waiting 72 h): refused in
 * production, where the quarantine is what protects an account whose session was stolen.
 */
export function keyQuarantineMs(
  override: string | undefined,
  nodeEnv: string | undefined,
): number {
  if (override === undefined || override === "") return KEY_QUARANTINE_MS;
  if (nodeEnv === "production") {
    throw new Error("KEY_QUARANTINE_SECONDS_OVERRIDE is refused in production");
  }
  const seconds = Number(override);
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error(
      "KEY_QUARANTINE_SECONDS_OVERRIDE must be a whole number of seconds",
    );
  }
  return seconds * 1000;
}
