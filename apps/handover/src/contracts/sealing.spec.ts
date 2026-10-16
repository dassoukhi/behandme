import canonicalize from "canonicalize";
import { type Kysely, sql } from "kysely";
import { createHash, createPrivateKey, hkdfSync, sign } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ConflictError, InvalidInputError, NotFoundError } from "@lib/kernel";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { ContractsService } from "./application/contracts.service.js";
import { SealingService } from "./application/sealing.service.js";
import type { RegisteredKey, SealRequest } from "./domain/sealing.js";
import { KyselyHandoverStores } from "./infrastructure/kysely-handover.stores.js";
import { nodeSealCrypto } from "./infrastructure/node-seal-crypto.js";
import { nodeSha256 } from "./infrastructure/sha256.js";
import fixture from "./testing/seal-v1.json" with { type: "json" };

// A contract sealed by the app's lib/crypto (fixture shared with the app repo): handover accepts it, and
// refuses each mutation of it, one rule at a time. On the real schema (PGlite), as svc_handover.

type Who = "owner" | "accessor" | "v1" | "v2" | "v3";
const P = fixture.participants as Record<
  Who,
  (typeof fixture.participants)["owner"]
>;
const ID = fixture.contract_id;
const OWNER = P.owner.user_id;
const b = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));

let t: TestDatabase;
let db: Kysely<any>;
let clock: FakeClock;
let sealing: SealingService;
let contracts: ContractsService;

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`reset role`.execute(db);
  await sql`delete from handover.contracts`.execute(db);
  await sql`insert into handover.contracts (id, owner_id, category) values (${ID}::uuid, ${OWNER}, 'networks')`.execute(
    db,
  );
  await sql`insert into handover.participants (contract_id, user_id, role, position) values
    (${ID}::uuid, ${P.accessor.user_id}, 'accessor', 0),
    (${ID}::uuid, ${P.v1.user_id}, 'validator', 0),
    (${ID}::uuid, ${P.v2.user_id}, 'validator', 1),
    (${ID}::uuid, ${P.v3.user_id}, 'validator', 2)`.execute(db);
  await sql`set role svc_handover`.execute(db);
  clock = new FakeClock(new Date("2026-10-15T12:00:00Z"));
  const stores = new KyselyHandoverStores(db);
  sealing = new SealingService(stores, nodeSealCrypto, clock);
  contracts = new ContractsService(stores, nodeSha256, clock);
});
afterEach(() => sql`reset role`.execute(db));

/** The fixture as a seal request, and the participants' registered keys. */
function request(): SealRequest {
  const s = fixture.sealed;
  return {
    expectedVersion: 1,
    accessorId: P.accessor.user_id,
    validatorIds: [P.v1.user_id, P.v2.user_id, P.v3.user_id],
    envelope: b(s.envelope),
    ownerWrap: b(s.owner_wrap),
    shares: s.shares.map((x) => ({
      userId: x.user_id,
      index: x.index,
      keyVersion: x.key_version,
      wrap: b(x.wrap),
    })),
    manifest: structuredClone(s.manifest),
    manifestSignature: b(s.manifest_signature),
  };
}
function keys(): Map<string, RegisteredKey> {
  return new Map(
    (Object.values(P) as (typeof P)["owner"][]).map((p) => [
      p.user_id,
      {
        keyVersion: p.key_version,
        fingerprint: p.fingerprint,
        signingPublicKey: b(p.signing_public_key),
        usableFrom: new Date("2026-10-01T00:00:00Z"),
      },
    ]),
  );
}

describe("sealing", () => {
  it("accepts the app's sealing: the contract becomes active, with its first sealed version", async () => {
    const record = await sealing.seal(OWNER, ID, request(), keys());
    expect(record).toMatchObject({
      status: "active",
      sealed_version: 1,
      version: 2,
      allowed_actions: ["update", "seal", "revoke"],
    });
    const log = await contracts.events(OWNER, ID);
    expect(log.at(-1)).toMatchObject({
      type: "contract.sealed",
      actor_id: OWNER,
    });
    expect(JSON.parse(log.at(-1)!.body)).toEqual({
      sealed_version: 1,
      envelope_hash: fixture.sealed.envelope_hash,
      threshold: 2,
      accessor_id: P.accessor.user_id,
      validator_ids: [P.v1.user_id, P.v2.user_id, P.v3.user_id],
    });
  });

  it("is reserved to the owner", async () => {
    await expect(
      sealing.seal(P.v1.user_id, ID, request(), keys()),
    ).rejects.toThrow(NotFoundError);
    await expect(
      sealing.seal("user_stranger", ID, request(), keys()),
    ).rejects.toThrow(NotFoundError);
  });

  const mutations: [
    string,
    (r: SealRequest, k: Map<string, RegisteredKey>) => void,
    typeof InvalidInputError | typeof ConflictError,
  ][] = [
    [
      "a changed manifest (threshold)",
      (r) => ((r.manifest as { threshold: number }).threshold = 3),
      InvalidInputError,
    ],
    [
      "a forged signature",
      (r) => (r.manifestSignature[0] ^= 1),
      InvalidInputError,
    ],
    [
      "another owner signing key",
      (r, k) => (k.get(OWNER)!.signingPublicKey = b(P.v1.signing_public_key)),
      InvalidInputError,
    ],
    ["a changed envelope", (r) => (r.envelope[20] ^= 1), InvalidInputError],
    [
      "a manifest for another contract",
      (r) => ((r.manifest as { contract_id: string }).contract_id = "x"),
      InvalidInputError,
    ],
    [
      "an extra manifest field",
      (r) => ((r.manifest as Record<string, unknown>).note = "hi"),
      InvalidInputError,
    ],
    [
      "a validator's key changed since",
      (r, k) => (k.get(P.v2.user_id)!.fingerprint = "f".repeat(64)),
      ConflictError,
    ],
    [
      "a validator without keys",
      (r, k) => void k.delete(P.v3.user_id),
      InvalidInputError,
    ],
    [
      "keys still in quarantine",
      (r, k) =>
        (k.get(P.accessor.user_id)!.usableFrom = new Date(
          "2026-10-16T00:00:00Z",
        )),
      ConflictError,
    ],
    [
      "participants that differ from the manifest",
      (r) => (r.accessorId = P.v1.user_id),
      InvalidInputError,
    ],
    ["a missing share", (r) => void r.shares.pop(), InvalidInputError],
    [
      "a share for the wrong user",
      (r) => (r.shares[0].userId = P.v2.user_id),
      InvalidInputError,
    ],
    [
      "a truncated owner wrap",
      (r) => (r.ownerWrap = r.ownerWrap.subarray(0, 100)),
      InvalidInputError,
    ],
    ["a stale contract version", (r) => (r.expectedVersion = 7), ConflictError],
  ];

  it.each(mutations)(
    "refuses %s, and writes nothing",
    async (_case, mutate, error) => {
      const r = request();
      const k = keys();
      mutate(r, k);
      await expect(sealing.seal(OWNER, ID, r, k)).rejects.toThrow(error);
      const contract = await contracts.get(OWNER, ID);
      expect(contract).toMatchObject({ status: "draft", sealed_version: 0 });
      await expect(sealing.material(OWNER, ID)).rejects.toThrow(NotFoundError);
    },
  );
});

describe("the envelope's padding", () => {
  // Signed again by the owner, as their phone would: the manifest names the envelope, so the padding
  // rule is what refuses it, not the hash or the signature.
  const ownerKey = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      // The app's derivation (docs/crypto-protocol.md, "Identity keys").
      d: Buffer.from(
        hkdfSync(
          "sha256",
          new Uint8Array(32).fill(P.owner.seed_byte),
          "behindme/v1/identity",
          "signing/ed25519",
          32,
        ),
      ).toString("base64url"),
      x: Buffer.from(P.owner.signing_public_key, "base64").toString(
        "base64url",
      ),
    },
    format: "jwk",
  });
  const withEnvelope = (envelope: Uint8Array): SealRequest => {
    const r = request();
    const manifest = {
      ...(r.manifest as Record<string, unknown>),
      envelope_hash: createHash("sha256").update(envelope).digest("hex"),
    };
    const signature = sign(
      null,
      Buffer.from(canonicalize(manifest)!),
      ownerKey,
    );
    return {
      ...r,
      envelope,
      manifest,
      manifestSignature: new Uint8Array(signature),
    };
  };
  const envelope = () => b(fixture.sealed.envelope);

  it("accepts the same envelope signed again (the test signs as the owner)", async () => {
    await expect(
      sealing.seal(OWNER, ID, withEnvelope(envelope()), keys()),
    ).resolves.toMatchObject({ status: "active" });
  });

  it.each([
    ["an unpadded envelope (format 1)", (e: Uint8Array) => ((e[0] = 1), e)],
    [
      "a size between two padding steps",
      (e: Uint8Array) => new Uint8Array([...e, ...new Uint8Array(16)]),
    ],
    [
      "less than 1 KiB of padded secret",
      (e: Uint8Array) => e.subarray(0, 1 + 12 + 512 + 16),
    ],
  ])("refuses %s", async (_case, change) => {
    await expect(
      sealing.seal(OWNER, ID, withEnvelope(change(envelope())), keys()),
    ).rejects.toThrow(/padded/);
  });
});

describe("what the server cannot check", () => {
  it("stores wraps as given: it cannot tell whose key a wrap is for", async () => {
    // Swapped wraps pass, but each recipient's phone refuses a wrap made for another slot (the HPKE
    // context binds contract, version, index, user and key): see the app's lib/crypto tests, "wraps".
    const r = request();
    [r.shares[0].wrap, r.shares[1].wrap] = [r.shares[1].wrap, r.shares[0].wrap];
    await sealing.seal(OWNER, ID, r, keys());
    expect((await sealing.material(P.v1.user_id, ID)).share?.wrap).toBe(
      fixture.sealed.shares[1].wrap,
    );
  });
});

describe("sealed material, by role", () => {
  beforeEach(() => sealing.seal(OWNER, ID, request(), keys()));

  it("gives the owner the envelope and their wrap", async () => {
    const material = await sealing.material(OWNER, ID);
    expect(material).toMatchObject({
      sealed_version: 1,
      envelope: fixture.sealed.envelope,
      owner_wrap: fixture.sealed.owner_wrap,
      manifest_signature: fixture.sealed.manifest_signature,
    });
    expect(material.manifest).toEqual(fixture.sealed.manifest);
    expect(material).not.toHaveProperty("share");
  });

  it("gives a validator their own share only, never the envelope", async () => {
    const material = await sealing.material(P.v2.user_id, ID);
    expect(material.share).toEqual({
      index: 2,
      key_version: 1,
      wrap: fixture.sealed.shares[1].wrap,
    });
    expect(material).not.toHaveProperty("envelope");
    expect(material).not.toHaveProperty("owner_wrap");
  });

  it("gives the accessor the manifest alone before release", async () => {
    const material = await sealing.material(P.accessor.user_id, ID);
    expect(Object.keys(material).sort()).toEqual([
      "manifest",
      "manifest_signature",
      "sealed_version",
    ]);
  });

  it("gives a stranger nothing", async () => {
    await expect(sealing.material("user_stranger", ID)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("re-sealing and revoking", () => {
  it("refuses replaying the same sealing: a new sealing has the next number", async () => {
    await sealing.seal(OWNER, ID, request(), keys());
    // Same material, for the contract's new version: its manifest still says sealed version 1.
    const replay = { ...request(), expectedVersion: 2 };
    await expect(sealing.seal(OWNER, ID, replay, keys())).rejects.toThrow(
      "The manifest is for another contract or version",
    );
  });

  it("deletes every ciphertext when the owner revokes, and logs it", async () => {
    await sealing.seal(OWNER, ID, request(), keys());
    const revoked = await sealing.revoke(OWNER, ID, 2);
    expect(revoked).toMatchObject({ status: "revoked", allowed_actions: [] });
    await expect(sealing.material(OWNER, ID)).rejects.toThrow(NotFoundError);
    await sql`reset role`.execute(db);
    const { rows } =
      await sql`select 1 from handover.envelopes union all select 1 from handover.key_wraps`.execute(
        db,
      );
    expect(rows).toEqual([]);
    const log = await contracts.events(OWNER, ID);
    expect(log.map((e) => e.type).slice(-2)).toEqual([
      "contract.sealed",
      "contract.revoked",
    ]);
  });

  it("refuses revoking a draft (it is deleted instead) or for someone else", async () => {
    await expect(sealing.revoke(OWNER, ID, 1)).rejects.toThrow(ConflictError);
    await sealing.seal(OWNER, ID, request(), keys());
    await expect(sealing.revoke(P.accessor.user_id, ID, 2)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("rights", () => {
  it.each([
    "svc_gateway",
    "svc_notifier",
    "svc_worker",
    "anon",
    "authenticated",
  ])("keep %s away from the sealed material", async (role) => {
    await sql`reset role`.execute(db);
    for (const table of ["envelopes", "key_wraps"]) {
      await expect(
        t.asRole(role, (d) =>
          sql.raw(`select * from handover.${table}`).execute(d),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
