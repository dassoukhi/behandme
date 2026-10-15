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
import { ConflictError, InvalidInputError, NotFoundError } from "@lib/kernel";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { TrustService } from "../users/application/trust.service.js";
import { KyselyTrustRepository } from "../users/infrastructure/kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "../users/infrastructure/kysely-users.unit-of-work.js";
import { KeysService } from "./application/keys.service.js";
import { KyselyKeyRepository } from "./infrastructure/kysely-key.repository.js";
import { nodeKeyCryptography } from "./infrastructure/node-key-cryptography.js";
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
