import { type Kysely, sql } from "kysely";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createCheckAuthorization } from "@clerk/shared/authorization";
import { ConflictError, InvalidInputError, NotFoundError } from "@lib/kernel";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { TrustService } from "../users/application/trust.service.js";
import { KyselyTrustRepository } from "../users/infrastructure/kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "../users/infrastructure/kysely-users.unit-of-work.js";
import { KeyCareService } from "./application/key-care.service.js";
import { KeysService } from "./application/keys.service.js";
import { toPublicKeys } from "./application/public-keys.js";
import { keyProofStatement } from "./domain/care.js";
import {
  type FactorVerificationAge,
  KEY_QUARANTINE_MS,
  keyQuarantineMs,
  type KeySubmission,
  recentlyVerified,
  registrationStatement,
  RESET_REVERIFICATION,
  ReverificationRequired,
} from "./domain/keys.js";
import { KyselyKeyRepository } from "./infrastructure/kysely-key.repository.js";
import { KyselyKeysUnitOfWork } from "./infrastructure/kysely-keys.unit-of-work.js";
import { nodeKeyCryptography } from "./infrastructure/node-key-cryptography.js";
import { KeysController } from "./interface/keys.controller.js";
import fixture from "./testing/key-registration-v1.json" with { type: "json" };

// The keys made and signed by the app's lib/crypto (fixture shared with the app repo), checked here
// with node:crypto, on the real schema as svc_gateway.
const ME = fixture.user_id;
const b64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
const submission = () => ({
  keyVersion: fixture.registration.key_version,
  kemPublicKey: b64(fixture.registration.kem_public_key),
  signingPublicKey: b64(fixture.registration.signing_public_key),
  signature: b64(fixture.registration.signature),
});

let t: TestDatabase;
let db: Kysely<any>;
let keys: KeysService;
let care: KeyCareService;
let clock: FakeClock;

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`reset role`.execute(db);
  await sql`delete from public.trusted`.execute(db);
  await sql`delete from public.users`.execute(db);
  await sql`delete from core.outbox`.execute(db);
  for (const id of [ME, "user_friend", "user_fan", "user_stranger"]) {
    await sql`insert into public.users (id, email) values (${id}, ${id + "@x.fr"})`.execute(
      db,
    );
  }
  await sql`set role svc_gateway`.execute(db);
  clock = new FakeClock(new Date("2026-10-15T09:00:00Z"));
  const trust = new TrustService(
    new KyselyTrustRepository(db),
    new KyselyUsersUnitOfWork(db),
  );
  keys = new KeysService(
    new KyselyKeyRepository(db),
    nodeKeyCryptography,
    clock,
    trust,
    new KyselyKeysUnitOfWork(db),
    {
      describe: async () => ({
        name: "Nina Martin",
        trusterIds: ["user_friend"],
      }),
    },
    KEY_QUARANTINE_MS,
  );
  care = new KeyCareService(
    new KyselyKeyRepository(db),
    nodeKeyCryptography,
    clock,
  );
});
afterEach(() => sql`reset role`.execute(db));

describe("registration", () => {
  it("accepts the app's signed keys and computes the same fingerprint", async () => {
    const registered = await keys.register(ME, submission());
    expect(registered).toMatchObject({
      userId: ME,
      keyVersion: 1,
      fingerprint: fixture.fingerprint,
      usableFrom: new Date("2026-10-15T09:00:00Z"),
    });
    expect((await keys.mine(ME)).kemPublicKey).toEqual(
      submission().kemPublicKey,
    );
  });

  it("refuses keys signed for another account", async () => {
    await expect(keys.register("user_friend", submission())).rejects.toThrow(
      new InvalidInputError("The registration signature does not verify"),
    );
  });

  it.each([
    [
      "a changed KEM key",
      (s: ReturnType<typeof submission>) => (s.kemPublicKey[10] ^= 1),
    ],
    [
      "a changed signature",
      (s: ReturnType<typeof submission>) => (s.signature[0] ^= 1),
    ],
    [
      "another key version",
      (s: ReturnType<typeof submission>) => (s.keyVersion = 2),
    ],
  ])("refuses %s", async (_case, tamper) => {
    const s = submission();
    tamper(s);
    await expect(keys.register(ME, s)).rejects.toThrow(InvalidInputError);
    await expect(keys.mine(ME)).rejects.toThrow(NotFoundError);
  });

  it.each([
    ["a short KEM key", { kemPublicKey: new Uint8Array(32) }],
    ["a long signing key", { signingPublicKey: new Uint8Array(33) }],
  ])("refuses %s", async (_case, change) => {
    await expect(
      keys.register(ME, { ...submission(), ...change }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("registers once: a second time is a conflict", async () => {
    await keys.register(ME, submission());
    await expect(keys.register(ME, submission())).rejects.toThrow(
      ConflictError,
    );
  });

  it("goes away with the profile", async () => {
    await keys.register(ME, submission());
    await sql`delete from public.users where id = ${ME}`.execute(db);
    const { rows } = await sql`select 1 from core.user_keys`.execute(db);
    expect(rows).toEqual([]);
  });
});

describe("visibility", () => {
  it("shows the keys of the caller, of people they trust and of people who trust them", async () => {
    await keys.register(ME, submission());
    const trust = new KyselyTrustRepository(db);
    await trust.add("user_friend", ME); // the friend trusts ME: the friend may read ME's keys
    await trust.add(ME, "user_fan"); // ME trusts the fan: the fan may read ME's keys too

    for (const viewer of [ME, "user_friend", "user_fan"]) {
      expect((await keys.visible(viewer, [ME])).map((k) => k.userId)).toEqual([
        ME,
      ]);
    }
    expect(await keys.visible("user_stranger", [ME])).toEqual([]);
  });

  it("leaves out users without keys", async () => {
    expect(await keys.visible(ME, [ME, "user_friend"])).toEqual([]);
  });
});

describe("history", () => {
  it("is never changed", async () => {
    await sql`reset role`.execute(db);
    await sql`insert into core.user_key_history (user_id, key_version, kem_public_key, signing_public_key, fingerprint, signature, created_at, reason)
      values (${ME}, 1, ${submission().kemPublicKey}, ${submission().signingPublicKey}, ${fixture.fingerprint}, ${submission().signature}, now(), 'reset')`.execute(
      db,
    );
    await expect(
      sql`update core.user_key_history set reason = 'reset'`.execute(db),
    ).rejects.toThrow(/never changed/);
  });
});

/** A key pair made here (node:crypto) and its submission, signed for `userId` and `keyVersion`. */
function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signing = new Uint8Array(
    publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const kem = new Uint8Array(randomBytes(1216));
  const submit = (userId: string, keyVersion: number): KeySubmission => {
    const statement = nodeKeyCryptography.canonicalJson(
      registrationStatement(
        userId,
        keyVersion,
        Buffer.from(kem).toString("base64"),
        Buffer.from(signing).toString("base64"),
      ),
    );
    return {
      keyVersion,
      kemPublicKey: kem,
      signingPublicKey: signing,
      signature: new Uint8Array(sign(null, statement, privateKey)),
    };
  };
  const prove = (userId: string, keyVersion: number, day: string) => ({
    keyVersion,
    day,
    signature: new Uint8Array(
      sign(
        null,
        nodeKeyCryptography.canonicalJson(
          keyProofStatement(userId, keyVersion, day),
        ),
        privateKey,
      ),
    ),
  });
  return Object.assign(submit, { prove });
}

const FRESH: FactorVerificationAge = [2, -1];

describe("reset", () => {
  it("replaces the keys after a fresh reverification, keeps the old ones, holds the new ones back and says so", async () => {
    await keys.register(ME, submission());
    const next = keyPair()(ME, 2);
    const reset = await keys.reset(ME, next, FRESH);

    expect(reset).toMatchObject({
      keyVersion: 2,
      usableFrom: new Date("2026-10-18T09:00:00Z"),
      createdAt: new Date("2026-10-15T09:00:00Z"),
    });
    expect((await keys.mine(ME)).signingPublicKey).toEqual(
      next.signingPublicKey,
    );
    await sql`reset role`.execute(db);
    const history = await sql<{
      key_version: number;
      fingerprint: string;
      reason: string;
    }>`select key_version, fingerprint, reason from core.user_key_history`.execute(
      db,
    );
    expect(history.rows).toEqual([
      { key_version: 1, fingerprint: fixture.fingerprint, reason: "reset" },
    ]);
    const outbox = await sql<{
      type: string;
      envelope: { payload: unknown };
    }>`select type, envelope from core.outbox`.execute(db);
    expect(outbox.rows.map((r) => [r.type, r.envelope.payload])).toEqual([
      [
        "keys.rotated",
        {
          userId: ME,
          keyVersion: 2,
          usableFrom: "2026-10-18T09:00:00.000Z",
          userName: "Nina Martin",
          trusterIds: ["user_friend"],
        },
      ],
    ]);
  });

  it.each<[string, FactorVerificationAge | null]>([
    ["a token without fva", null],
    ["a first factor 11 minutes old, without MFA", [11, -1]],
    ["an old second factor, even with a fresh first one", [1, 30]],
    ["no factor ever verified", [-1, -1]],
  ])("asks Clerk's reverification first: %s", async (_case, fva) => {
    await keys.register(ME, submission());
    await expect(keys.reset(ME, keyPair()(ME, 2), fva)).rejects.toThrow(
      ReverificationRequired,
    );
    expect((await keys.mine(ME)).keyVersion).toBe(1);
  });

  it("decides reverification exactly as Clerk's own check", () => {
    const clerk = (fva: FactorVerificationAge) =>
      createCheckAuthorization({
        userId: ME,
        orgId: null,
        orgRole: null,
        orgPermissions: null,
        factorVerificationAge: fva,
        features: null,
        plans: null,
      })({ reverification: RESET_REVERIFICATION });
    const ages = [-1, 0, 1, 9, 10, 11, 60];
    for (const first of ages) {
      for (const second of ages) {
        const fva: FactorVerificationAge = [first, second];
        expect([fva, recentlyVerified(fva)]).toEqual([fva, clerk(fva)]);
      }
    }
  });

  it("refuses an account without keys, a version that is not the next one, and the same keys again", async () => {
    const pair = keyPair();
    await expect(keys.reset(ME, pair(ME, 2), FRESH)).rejects.toThrow(
      NotFoundError,
    );
    await keys.register(ME, pair(ME, 1));
    await expect(keys.reset(ME, keyPair()(ME, 3), FRESH)).rejects.toThrow(
      ConflictError,
    );
    await expect(keys.reset(ME, pair(ME, 2), FRESH)).rejects.toThrow(
      new InvalidInputError("These are already the account's keys"),
    );
    // Signed for another account: never accepted.
    await expect(
      keys.reset(ME, keyPair()("user_friend", 2), FRESH),
    ).rejects.toThrow(InvalidInputError);
    expect((await keys.mine(ME)).keyVersion).toBe(1);
  });

  it("lets only one of two resets at once win", async () => {
    await keys.register(ME, submission());
    const results = await Promise.allSettled([
      keys.reset(ME, keyPair()(ME, 2), FRESH),
      keys.reset(ME, keyPair()(ME, 2), FRESH),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason,
    ).toBeInstanceOf(ConflictError);
  });
});

describe("proving the phone holds the keys", () => {
  const appProof = () => ({
    keyVersion: fixture.proof.key_version,
    day: fixture.proof.day,
    signature: b64(fixture.proof.signature),
  });

  it("accepts the signature the app makes", async () => {
    await keys.register(ME, submission());
    expect((await care.mine(ME)).proven_on).toBeNull();
    await care.prove(ME, appProof());
    expect((await care.mine(ME)).proven_on).toBe("2026-10-15");
  });

  it.each([
    [
      "a changed signature",
      (p: ReturnType<typeof appProof>) => (p.signature[0] ^= 1),
    ],
    [
      "a signature of another day",
      (p: ReturnType<typeof appProof>) => (p.day = "2026-10-14"),
    ],
    [
      "a day too far from today",
      (p: ReturnType<typeof appProof>) => (p.day = "2026-10-01"),
    ],
    [
      "a short signature",
      (p: ReturnType<typeof appProof>) => (p.signature = new Uint8Array(10)),
    ],
  ])("refuses %s", async (_case, tamper) => {
    await keys.register(ME, submission());
    const p = appProof();
    tamper(p);
    await expect(care.prove(ME, p)).rejects.toThrow(InvalidInputError);
    expect((await care.mine(ME)).proven_on).toBeNull();
  });

  it("refuses another account's proof, and an account without keys", async () => {
    await expect(care.prove(ME, appProof())).rejects.toThrow(NotFoundError);
    const other = keyPair();
    await keys.register("user_friend", other("user_friend", 1));
    await expect(care.prove("user_friend", appProof())).rejects.toThrow(
      InvalidInputError,
    );
  });

  it("refuses a proof for keys that were replaced", async () => {
    const pair = keyPair();
    await keys.register(ME, pair(ME, 1));
    await keys.reset(ME, keyPair()(ME, 2), FRESH);
    await expect(
      care.prove(ME, pair.prove(ME, 1, "2026-10-15")),
    ).rejects.toThrow(ConflictError);
  });

  it("never moves back in time", async () => {
    const pair = keyPair();
    await keys.register(ME, pair(ME, 1));
    await care.prove(ME, pair.prove(ME, 1, "2026-10-15"));
    await care.prove(ME, pair.prove(ME, 1, "2026-10-14"));
    expect((await care.mine(ME)).proven_on).toBe("2026-10-15");
  });

  it("keeps all of it out of what others can see", async () => {
    await keys.register(ME, submission());
    await care.prove(ME, appProof());
    await care.updatePhrase(ME, {
      keyVersion: 1,
      checked: true,
      location: "notary",
    });
    const [mine] = await keys.visible(ME, [ME]);
    const shown = JSON.stringify(toPublicKeys(mine));
    expect(shown).not.toMatch(/proven|phrase|notary/);
  });
});

describe("the recovery phrase", () => {
  const DAY = 86_400_000;

  it("is not due before the user proved they kept it, then comes back after a week", async () => {
    await keys.register(ME, submission());
    expect(await care.mine(ME)).toMatchObject({
      phrase_checked_at: null,
      phrase_check_due: false,
    });
    await care.updatePhrase(ME, { keyVersion: 1, checked: true });
    expect(await care.mine(ME)).toMatchObject({
      phrase_checked_at: "2026-10-15T09:00:00.000Z",
      phrase_check_due: false,
    });
    clock.advance(7 * DAY);
    expect((await care.mine(ME)).phrase_check_due).toBe(true);
    await care.updatePhrase(ME, { keyVersion: 1, checked: true });
    expect((await care.mine(ME)).phrase_check_due).toBe(false);
    // The second check: the next one is a month away.
    clock.advance(29 * DAY);
    expect((await care.mine(ME)).phrase_check_due).toBe(false);
    clock.advance(DAY);
    expect((await care.mine(ME)).phrase_check_due).toBe(true);
  });

  it("counts the same check once, however many times it is answered", async () => {
    await keys.register(ME, submission());
    for (let i = 0; i < 3; i++) {
      await care.updatePhrase(ME, { keyVersion: 1, checked: true });
    }
    clock.advance(7 * DAY);
    expect((await care.mine(ME)).phrase_check_due).toBe(true);
  });

  it("refuses what is said about keys that were replaced", async () => {
    await keys.register(ME, submission());
    await keys.reset(ME, keyPair()(ME, 2), FRESH);
    await expect(
      care.updatePhrase(ME, { keyVersion: 1, checked: true }),
    ).rejects.toThrow(ConflictError);
    expect((await care.mine(ME)).phrase_checked_at).toBeNull();
  });

  it("keeps where the user says it is, without counting that as a check", async () => {
    await keys.register(ME, submission());
    await care.updatePhrase(ME, {
      keyVersion: 1,
      location: "password_manager",
    });
    expect(await care.mine(ME)).toMatchObject({
      phrase_location: "password_manager",
      phrase_checked_at: null,
    });
  });

  it("refuses an empty change, and an account without keys", async () => {
    await keys.register(ME, submission());
    await expect(care.updatePhrase(ME, { keyVersion: 1 })).rejects.toThrow(
      InvalidInputError,
    );
    await expect(
      care.updatePhrase("user_friend", { keyVersion: 1, checked: true }),
    ).rejects.toThrow(NotFoundError);
  });

  it("starts over with new keys: nothing known of the old ones applies to them", async () => {
    const pair = keyPair();
    await keys.register(ME, pair(ME, 1));
    await care.prove(ME, pair.prove(ME, 1, "2026-10-15"));
    await care.updatePhrase(ME, {
      keyVersion: 1,
      checked: true,
      location: "safe",
    });
    await keys.reset(ME, keyPair()(ME, 2), FRESH);
    expect(await care.mine(ME)).toEqual({
      proven_on: null,
      phrase_checked_at: null,
      phrase_check_due: false,
      phrase_location: null,
    });
  });
});

describe("the answer to new keys", () => {
  const body = (s: KeySubmission) => ({
    key_version: s.keyVersion,
    kem_public_key: Buffer.from(s.kemPublicKey).toString("base64"),
    signing_public_key: Buffer.from(s.signingPublicKey).toString("base64"),
    signature: Buffer.from(s.signature).toString("base64"),
  });

  it("is made from what was written: a failed read must not make accepted keys look refused", async () => {
    const controller = new KeysController(keys, {
      mine: async () => {
        throw new Error("connection lost");
      },
    } as unknown as KeyCareService);
    const pair = keyPair();
    expect(await controller.register(ME, body(pair(ME, 1)))).toMatchObject({
      key_version: 1,
      phrase_checked_at: null,
      phrase_check_due: false,
    });
    expect(
      await controller.reset(ME, FRESH, body(keyPair()(ME, 2))),
    ).toMatchObject({ key_version: 2, proven_on: null });
  });
});

describe("reminders", () => {
  const DAY = 86_400_000;
  const remind = () =>
    new KyselyKeysUnitOfWork(db).run((tx) => care.remind(tx));
  const published = async () => {
    await sql`reset role`.execute(db);
    const { rows } = await sql<{
      type: string;
      envelope: { payload: unknown };
    }>`select type, envelope from core.outbox`.execute(db);
    await sql`set role svc_gateway`.execute(db);
    return rows.map((r) => [r.type, r.envelope.payload]);
  };

  it("tells the notifier of a phrase check that fell due, and only once", async () => {
    await keys.register(ME, submission());
    await care.updatePhrase(ME, { keyVersion: 1, checked: true });
    expect(await remind()).toBe(0);
    clock.advance(7 * DAY);
    expect(await remind()).toBe(1);
    expect(await published()).toEqual([
      ["keys.care_reminder", { userId: ME, kind: "phrase_check" }],
    ]);
    clock.advance(DAY);
    expect(await remind()).toBe(0);
  });

  it("asks for the yearly check-up in January, then leaves alone whoever opened the app", async () => {
    const pair = keyPair();
    await keys.register(ME, pair(ME, 1));
    await keys.register("user_friend", keyPair()("user_friend", 1));
    clock.advance(80 * DAY); // 3 January 2027
    await care.prove(ME, pair.prove(ME, 1, "2027-01-03"));
    expect(await remind()).toBe(1);
    expect(await published()).toEqual([
      ["keys.care_reminder", { userId: "user_friend", kind: "key_checkup" }],
    ]);
  });

  it("is routed to the notifier and asked of the gateway", async () => {
    await sql`reset role`.execute(db);
    const { rows } = await sql<{
      event_type: string;
      queue: string;
    }>`select event_type, queue from messaging.subscriptions
       where event_type in ('keys.care_reminder', 'maintenance.key_care_due')
       order by event_type`.execute(db);
    expect(rows).toEqual([
      { event_type: "keys.care_reminder", queue: "notifier" },
      { event_type: "maintenance.key_care_due", queue: "gateway" },
    ]);
  });
});

describe("quarantine setting", () => {
  it("is 72 hours unless overridden outside production", () => {
    expect(keyQuarantineMs(undefined, "production")).toBe(72 * 3_600_000);
    expect(keyQuarantineMs("", "development")).toBe(72 * 3_600_000);
    expect(keyQuarantineMs("60", "development")).toBe(60_000);
    expect(() => keyQuarantineMs("60", "production")).toThrow(
      "refused in production",
    );
    expect(() => keyQuarantineMs("-5", "development")).toThrow();
    expect(() => keyQuarantineMs("1.5", "development")).toThrow();
  });
});
