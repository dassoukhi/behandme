import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes in base64url without padding: what `newSecretToken` gives. */
export const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Whether `token` can be one of ours: anything else is refused before any lookup. */
export function isSecretToken(token: unknown): token is string {
  return typeof token === "string" && SECRET_TOKEN_PATTERN.test(token);
}

/**
 * A secret handed to someone in a link or a QR code (an invitation, a contact code): 32 random bytes, base64url
 * without padding. Whoever holds it may use it: it travels in request bodies, never in a URL (URLs are logged), and
 * the server keeps its hash only.
 */
export function newSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the server stores of a secret token: its SHA-256, so that a database dump holds no usable link. */
export function secretTokenHash(token: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(token, "utf8").digest());
}
