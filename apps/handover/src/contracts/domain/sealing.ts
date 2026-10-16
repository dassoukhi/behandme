import { ConflictError, InvalidInputError } from "@lib/kernel";
import { assertValidDraft, type Contract } from "./contract.js";

// What the server checks when an owner seals a contract (the app's docs/crypto-protocol.md, "Sealing").
// It cannot open anything; it makes sure the sealed material is complete, well formed and signed by the
// owner over the right participants and keys, so that nobody (not even a server bug) can mix it up.

export const SUITE_NAME =
  "behindme/v1 HPKE(X-Wing, HKDF-SHA256, AES-256-GCM) + Shamir GF(256)";
const WRAP_FORMAT = 0x01;
const ENC_LENGTH = 1120; // X-Wing ciphertext
const TAG_LENGTH = 16; // AES-GCM
const NONCE_LENGTH = 12;
const KEY_LENGTH = 32; // contract key K
const SHAMIR_SHARE_LENGTH = 33; // 32 bytes + the share's x coordinate

// Envelope format 2 pads the secret to 1 KiB, or to the next power of two up to 32 KiB, so that its size
// does not give the secret's length; format 1 (unpadded) is no longer accepted for a new sealing.
const ENVELOPE_FORMAT = 0x02;
const MIN_PADDED_LENGTH = 1024;
const MAX_PADDED_LENGTH = 32768;

/** A format 2 envelope whose size is one of the padding steps. */
export function isPaddedEnvelope(envelope: Uint8Array): boolean {
  const padded = envelope.length - (1 + NONCE_LENGTH + TAG_LENGTH);
  return (
    envelope[0] === ENVELOPE_FORMAT &&
    padded >= MIN_PADDED_LENGTH &&
    padded <= MAX_PADDED_LENGTH &&
    (padded & (padded - 1)) === 0
  );
}

export const wrapLength = (secretLength: number) =>
  1 + ENC_LENGTH + secretLength + TAG_LENGTH;

/** A wrapped key share of a contract with `validators` validators (n = 1: the share is K itself). */
export function isShareWrap(wrap: Uint8Array, validators: number): boolean {
  const shareLength = validators === 1 ? KEY_LENGTH : SHAMIR_SHARE_LENGTH;
  return wrap[0] === WRAP_FORMAT && wrap.length === wrapLength(shareLength);
}

export interface ManifestParty {
  user_id: string;
  key_version: number;
  fingerprint: string;
}

export interface Manifest {
  type: "behindme/v1/manifest";
  suite: string;
  contract_id: string;
  version: number;
  envelope_hash: string;
  threshold: number;
  owner: ManifestParty;
  accessor: ManifestParty;
  validators: (ManifestParty & { index: number; commitment: string })[];
}

/** A user's current public keys, from the gateway (which owns them). */
export interface RegisteredKey {
  keyVersion: number;
  fingerprint: string;
  signingPublicKey: Uint8Array;
  usableFrom: Date;
}

export interface SealRequest {
  /** The contract's version the owner saw: a sealing never overwrites a change made meanwhile. */
  expectedVersion: number;
  accessorId: string;
  validatorIds: string[];
  envelope: Uint8Array;
  ownerWrap: Uint8Array;
  shares: {
    userId: string;
    index: number;
    keyVersion: number;
    wrap: Uint8Array;
  }[];
  manifest: unknown;
  manifestSignature: Uint8Array;
}

export interface SealCrypto {
  sha256Hex(bytes: Uint8Array): string;
  canonicalJson(value: unknown): string;
  verifyEd25519(
    publicKey: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array,
  ): boolean;
}

export function threshold(validators: number): number {
  return Math.floor(validators / 2) + 1;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isParty = (value: unknown): value is ManifestParty => {
  const p = value as ManifestParty;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.user_id === "string" &&
    Number.isInteger(p.key_version) &&
    typeof p.fingerprint === "string" &&
    HEX64.test(p.fingerprint)
  );
};

/** The manifest's shape, field by field: anything else (extra keys included) is refused. */
export function parseManifest(value: unknown): Manifest {
  const m = value as Manifest;
  const keys = (o: object) => Object.keys(o).sort().join(",");
  const ok =
    typeof m === "object" &&
    m !== null &&
    keys(m) ===
      "accessor,contract_id,envelope_hash,owner,suite,threshold,type,validators,version" &&
    m.type === "behindme/v1/manifest" &&
    m.suite === SUITE_NAME &&
    typeof m.contract_id === "string" &&
    Number.isInteger(m.version) &&
    typeof m.envelope_hash === "string" &&
    HEX64.test(m.envelope_hash) &&
    Number.isInteger(m.threshold) &&
    isParty(m.owner) &&
    keys(m.owner) === "fingerprint,key_version,user_id" &&
    isParty(m.accessor) &&
    keys(m.accessor) === "fingerprint,key_version,user_id" &&
    Array.isArray(m.validators) &&
    m.validators.every(
      (v) =>
        isParty(v) &&
        keys(v) === "commitment,fingerprint,index,key_version,user_id" &&
        Number.isInteger(v.index) &&
        typeof v.commitment === "string" &&
        HEX64.test(v.commitment),
    );
  if (!ok)
    throw new InvalidInputError("The manifest is not a behindme/v1 manifest");
  return m;
}

/**
 * Checks a sealing request against the contract, the participants' registered keys and the owner's
 * signature. Returns the manifest and its canonical text (what was signed), or throws.
 */
export function checkSeal(
  contract: Contract,
  request: SealRequest,
  keys: ReadonlyMap<string, RegisteredKey>,
  crypto: SealCrypto,
  now: Date,
): { manifest: Manifest; manifestText: string } {
  // Who takes part: the same rules as a draft.
  assertValidDraft(contract.ownerId, {
    category: contract.category,
    description: contract.description,
    accessorId: request.accessorId,
    validatorIds: request.validatorIds,
  });
  if (request.expectedVersion !== contract.version) {
    throw new ConflictError(
      "The contract changed meanwhile: reload it and seal again",
    );
  }
  const manifest = parseManifest(request.manifest);
  const n = request.validatorIds.length;
  // Each sealing has the next number; wrap contexts and the envelope are bound to it.
  const sealedVersion = contract.sealedVersion + 1;
  if (
    manifest.contract_id !== contract.id ||
    manifest.version !== sealedVersion
  ) {
    throw new InvalidInputError(
      "The manifest is for another contract or version",
    );
  }
  if (manifest.threshold !== threshold(n)) {
    throw new InvalidInputError(
      `The threshold must be ${threshold(n)} for ${n} validator(s)`,
    );
  }

  // Participants and their keys: exactly the registered ones, usable now.
  const expected: [ManifestParty, string][] = [
    [manifest.owner, contract.ownerId],
    [manifest.accessor, request.accessorId],
  ];
  if (manifest.validators.length !== n) {
    throw new InvalidInputError("The manifest does not list every validator");
  }
  manifest.validators.forEach((v, i) => {
    if (v.index !== i + 1)
      throw new InvalidInputError("Validator indexes must be 1 to n, in order");
    expected.push([v, request.validatorIds[i]]);
  });
  for (const [party, userId] of expected) {
    const registered = keys.get(userId);
    if (party.user_id !== userId) {
      throw new InvalidInputError(
        "The manifest does not name the contract's participants",
      );
    }
    if (!registered)
      throw new InvalidInputError(`${userId} has no registered keys`);
    if (
      party.key_version !== registered.keyVersion ||
      party.fingerprint !== registered.fingerprint
    ) {
      throw new ConflictError(
        `The keys of ${userId} changed: seal again with their current keys`,
      );
    }
    if (registered.usableFrom > now) {
      throw new ConflictError(
        `The keys of ${userId} are not usable yet (recent reset)`,
      );
    }
  }

  // The owner signed exactly this manifest.
  const manifestText = crypto.canonicalJson(manifest);
  const owner = keys.get(contract.ownerId)!;
  if (
    !crypto.verifyEd25519(
      owner.signingPublicKey,
      new TextEncoder().encode(manifestText),
      request.manifestSignature,
    )
  ) {
    throw new InvalidInputError("The manifest signature does not verify");
  }

  // The envelope is the one the manifest names.
  const { envelope } = request;
  if (!isPaddedEnvelope(envelope)) {
    throw new InvalidInputError(
      "The envelope is not a padded behindme/v1 envelope (format 2)",
    );
  }
  if (crypto.sha256Hex(envelope) !== manifest.envelope_hash) {
    throw new InvalidInputError(
      "The envelope does not match the manifest's envelope_hash",
    );
  }

  // Wraps: one for the owner (K), one per validator (its share), each the exact expected size. Their
  // content is opaque here: a wrap put in another slot is refused by the recipient's phone, whose HPKE
  // context names the slot.
  const isWrap = (wrap: Uint8Array, secretLength: number) =>
    wrap[0] === WRAP_FORMAT && wrap.length === wrapLength(secretLength);
  if (!isWrap(request.ownerWrap, KEY_LENGTH)) {
    throw new InvalidInputError("The owner's wrap is malformed");
  }
  const shareLength = n === 1 ? KEY_LENGTH : SHAMIR_SHARE_LENGTH;
  if (request.shares.length !== n)
    throw new InvalidInputError("One share per validator is required");
  request.shares.forEach((share) => {
    const listed = manifest.validators[share.index - 1];
    if (
      !listed ||
      listed.user_id !== share.userId ||
      listed.key_version !== share.keyVersion
    ) {
      throw new InvalidInputError("A share does not match the manifest");
    }
    if (!isWrap(share.wrap, shareLength)) {
      throw new InvalidInputError(
        `The share of validator ${share.index} is malformed`,
      );
    }
  });
  if (new Set(request.shares.map((s) => s.index)).size !== n) {
    throw new InvalidInputError("One share per validator is required");
  }
  return { manifest, manifestText };
}
