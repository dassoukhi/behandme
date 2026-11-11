import { InvalidInputError } from "@lib/kernel";
import { SIGNATURE_LENGTH } from "./keys.js";

// The keys' backup in a passkey (the app's docs/crypto-protocol.md, "Passkey backup"). The phone seals its seed
// under a key that only the passkey gives (WebAuthn PRF, after Face ID); the server keeps the box, which it cannot
// open, and hands it out after a fresh Clerk verification. The keys sign each backup, with the time: neither the
// server nor a stolen session can put in a box of their own, bring back an older one, or say that a passkey syncs
// when the phone did not.

const DAY_MS = 86_400_000;
const BOX_FORMAT = 0x01;
/** 0x01 ‖ nonce (12) ‖ AES-256-GCM of the seed (32) and its phrase's language (1), tag 16. */
export const BACKUP_BOX_LENGTH = 1 + 12 + 33 + 16;
/** A WebAuthn credential id (16 to 1023 bytes), base64url without padding. */
export const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{22,1364}$/;
/** The time the phone signs: ISO 8601 in UTC, with milliseconds, as JavaScript writes it. */
export const MADE_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface KeyBackup {
  userId: string;
  /** The keys in the box: a backup counts for these keys only. */
  keyVersion: number;
  /** The passkey whose PRF output opens the box. */
  credentialId: string;
  /** The passkey syncs to the user's other devices (WebAuthn's backup state, as the phone saw it). */
  synced: boolean;
  /** When the phone made the box, right after the passkey gave its output. */
  madeAt: Date;
  box: Uint8Array;
  signature: Uint8Array;
}

/** As the phone sends it: `madeAt` as it signed it. */
export type KeyBackupSubmission = Omit<KeyBackup, "userId" | "madeAt"> & {
  madeAt: string;
};

/** What the phone signs with the keys it backs up (canonical JSON, RFC 8785). */
export function keyBackupStatement(
  userId: string,
  keyVersion: number,
  credentialId: string,
  synced: boolean,
  madeAt: string,
  boxHash: string,
) {
  return {
    type: "behyndme/v1/key-backup",
    user_id: userId,
    key_version: keyVersion,
    credential_id: credentialId,
    synced,
    made_at: madeAt,
    box_hash: boxHash,
  };
}

export function assertCredentialId(credentialId: string): void {
  if (!CREDENTIAL_ID_PATTERN.test(credentialId)) {
    throw new InvalidInputError(
      "credential_id must be a WebAuthn credential id, base64url",
    );
  }
}

/** Sizes only; the signature is checked against the statement above. */
export function assertWellFormedBackup(backup: KeyBackupSubmission): void {
  assertCredentialId(backup.credentialId);
  if (backup.box.length !== BACKUP_BOX_LENGTH || backup.box[0] !== BOX_FORMAT) {
    throw new InvalidInputError(
      `box must be a passkey backup (${BACKUP_BOX_LENGTH} bytes)`,
    );
  }
  if (backup.signature.length !== SIGNATURE_LENGTH) {
    throw new InvalidInputError(
      "signature must be an Ed25519 signature (64 bytes)",
    );
  }
}

/**
 * The time a backup was made, if it is a real one, written as the phone writes it, within a day of the server's:
 * an old signed backup sent again is refused, and the phone's clock may be a little off.
 */
export function backupTime(madeAt: string, now: Date): Date {
  const at = new Date(madeAt);
  if (
    !MADE_AT_PATTERN.test(madeAt) ||
    Number.isNaN(at.getTime()) ||
    at.toISOString() !== madeAt ||
    Math.abs(at.getTime() - now.getTime()) > DAY_MS
  ) {
    throw new InvalidInputError("made_at must be the time of the backup");
  }
  return at;
}
