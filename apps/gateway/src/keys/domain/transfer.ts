import { InvalidInputError } from "@lib/kernel";
import { KEM_PUBLIC_KEY_LENGTH } from "./keys.js";

// Moving keys from the old phone to a new one (the app's docs/crypto-protocol.md, "Moving keys to a new
// phone"). The server only relays a wrap it cannot open, briefly, between two sessions of one account.

/**
 * Long enough to scan a code and confirm with Face ID. The daily retention deletes the transfers left behind; their
 * wrap opens only with the QR code's secret and the new phone's key, neither of which the server ever has.
 */
export const TRANSFER_TTL_MS = 5 * 60_000;

const WRAP_FORMAT = 0x01;
/** 0x01 ‖ X-Wing ciphertext (1120) ‖ AES-256-GCM of the seed (32) and its phrase's language (1), tag 16. */
export const TRANSFER_WRAP_LENGTH = 1 + 1120 + 33 + 16;

export interface KeyTransfer {
  id: string;
  userId: string;
  recipientKey: Uint8Array;
  keyVersion: number;
  wrap: Uint8Array | null;
  createdAt: Date;
  expiresAt: Date;
}

export function assertRecipientKey(key: Uint8Array): void {
  if (key.length !== KEM_PUBLIC_KEY_LENGTH) {
    throw new InvalidInputError(
      "recipient_key must be an X-Wing public key (1216 bytes)",
    );
  }
}

export function assertTransferWrap(wrap: Uint8Array): void {
  if (wrap.length !== TRANSFER_WRAP_LENGTH || wrap[0] !== WRAP_FORMAT) {
    throw new InvalidInputError(
      `wrap must be a transfer wrap (${TRANSFER_WRAP_LENGTH} bytes)`,
    );
  }
}

export function isOpen(transfer: KeyTransfer, now: Date): boolean {
  return transfer.expiresAt.getTime() > now.getTime();
}
