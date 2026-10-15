import { createHash, createPublicKey, verify } from "node:crypto";
import canonicalize from "canonicalize";
import type { SealCrypto } from "../domain/sealing.js";

/** node:crypto (OpenSSL) for SHA-256 and Ed25519; RFC 8785 canonical JSON. */
export const nodeSealCrypto: SealCrypto = {
  sha256Hex: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  canonicalJson(value) {
    const text = canonicalize(value);
    if (text === undefined)
      throw new Error("Value cannot be serialised as JSON");
    return text;
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
};
