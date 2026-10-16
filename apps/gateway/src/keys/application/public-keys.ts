import type { RegisteredKeys } from "../domain/keys.js";

/** Public keys as the API returns them (base64), for the app to encrypt to or check signatures. */
export interface PublicKeys {
  user_id: string;
  key_version: number;
  kem_public_key: string;
  signing_public_key: string;
  fingerprint: string;
  signature: string;
  usable_from: string;
  created_at: string;
}

export function toPublicKeys(keys: RegisteredKeys): PublicKeys {
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  return {
    user_id: keys.userId,
    key_version: keys.keyVersion,
    kem_public_key: b64(keys.kemPublicKey),
    signing_public_key: b64(keys.signingPublicKey),
    fingerprint: keys.fingerprint,
    signature: b64(keys.signature),
    usable_from: keys.usableFrom.toISOString(),
    created_at: keys.createdAt.toISOString(),
  };
}
