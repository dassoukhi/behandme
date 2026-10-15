import { createHash, createPublicKey, verify } from "node:crypto";
import canonicalize from "canonicalize";
import type { KeyCryptography } from "../application/ports.js";

/** node:crypto (OpenSSL) for Ed25519 and SHA-256; RFC 8785 canonical JSON. */
export const nodeKeyCryptography: KeyCryptography = {
  canonicalJson(value) {
    const text = canonicalize(value);
    if (text === undefined)
      throw new Error("Value cannot be serialised as JSON");
    return new TextEncoder().encode(text);
  },
  verifyEd25519(publicKey, message, signature) {
    try {
      const key = createPublicKey({
        key: {
          kty: "OKP",
          crv: "Ed25519",
          x: Buffer.from(publicKey).toString("base64url"),
        },
        format: "jwk",
      });
      return verify(null, message, key, signature);
    } catch {
      return false;
    }
  },
  sha256Hex: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  toBase64: (bytes) => Buffer.from(bytes).toString("base64"),
};
