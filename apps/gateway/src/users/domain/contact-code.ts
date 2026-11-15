// The QR code a user shows in person (the app's docs/crypto-protocol.md, "Contact code"): whoever scans it reads
// the user's profile and public keys, compares their fingerprint with the one the code carries, and may then add
// the user (the code is the proof the server asks for, users/application/trust.service.ts). The server never sees
// that fingerprint: it only resolves the token to its user, for a few minutes.

/** Long enough to scan it at a table; short enough that a photo of it is soon useless. */
export const CONTACT_CODE_TTL_MS = 10 * 60_000;

export interface ContactCode {
  userId: string;
  expiresAt: Date;
}

export function isValid(code: ContactCode, now: Date): boolean {
  return code.expiresAt.getTime() > now.getTime();
}
