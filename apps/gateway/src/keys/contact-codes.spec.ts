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
import {
  NotFoundError,
  SECRET_TOKEN_PATTERN,
  secretTokenHash,
} from "@lib/kernel";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { ProfileService } from "../users/application/profile.service.js";
import { TrustService } from "../users/application/trust.service.js";
import { KyselyProfileRepository } from "../users/infrastructure/kysely-profile.repository.js";
import { KyselyTrustRepository } from "../users/infrastructure/kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "../users/infrastructure/kysely-users.unit-of-work.js";
import { ContactCodeService } from "../users/application/contact-code.service.js";
import { CONTACT_CODE_TTL_MS } from "../users/domain/contact-code.js";
import { KyselyContactCodeRepository } from "../users/infrastructure/kysely-contact-code.repository.js";
import { KeysService } from "./application/keys.service.js";
import { ScannedContactService } from "./application/scanned-contact.service.js";
import { KEY_QUARANTINE_MS } from "./domain/keys.js";
import { KyselyKeyRepository } from "./infrastructure/kysely-key.repository.js";
import { KyselyKeysUnitOfWork } from "./infrastructure/kysely-keys.unit-of-work.js";
import { nodeKeyCryptography } from "./infrastructure/node-key-cryptography.js";
import fixture from "./testing/key-registration-v1.json" with { type: "json" };

// The code a user shows in person: it resolves, for ten minutes, to their profile and the keys the server holds,
// which the scanner's phone compares with the code's fingerprint. On the real schema (PGlite), as svc_gateway.
const BRUNO = fixture.user_id;
const MARIE = "user_marie";
const NO_KEYS = "user_nokeys";
const b64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

let t: TestDatabase;
let db: Kysely<any>;
let clock: FakeClock;
let codes: ScannedContactService;

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`reset role`.execute(db);
  await sql`delete from public.users`.execute(db);
  for (const id of [BRUNO, MARIE, NO_KEYS]) {
    await sql`insert into public.users (id, email, first_name) values (${id}, ${id + "@x.fr"}, ${id})`.execute(
      db,
    );
  }
  await sql`set role svc_gateway`.execute(db);
  clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const unitOfWork = new KyselyUsersUnitOfWork(db);
  const trust = new TrustService(new KyselyTrustRepository(db), unitOfWork);
  const keys = new KeysService(
    new KyselyKeyRepository(db),
    nodeKeyCryptography,
    clock,
    trust,
    new KyselyKeysUnitOfWork(db),
    { describe: async () => ({ name: null, trusterIds: [] }) },
    KEY_QUARANTINE_MS,
  );
  await keys.register(BRUNO, {
    keyVersion: 1,
    kemPublicKey: b64(fixture.registration.kem_public_key),
    signingPublicKey: b64(fixture.registration.signing_public_key),
    signature: b64(fixture.registration.signature),
  });
  codes = new ScannedContactService(
    new ContactCodeService(new KyselyContactCodeRepository(db), clock),
    new KyselyKeyRepository(db),
    new ProfileService(
      new KyselyProfileRepository(db),
      {
        getProfile: async () => {
          throw new Error("unused");
        },
        deleteUser: async () => undefined,
      },
      trust,
      unitOfWork,
    ),
  );
});
afterEach(() => sql`reset role`.execute(db));

describe("contact codes", () => {
  it("resolve to their owner's profile and registered keys, for a stranger too", async () => {
    const { token, expiresAt } = await codes.issue(BRUNO);
    expect(token).toMatch(SECRET_TOKEN_PATTERN);
    expect(expiresAt.getTime() - clock.now().getTime()).toBe(
      CONTACT_CODE_TTL_MS,
    );
    const resolved = await codes.resolve(MARIE, token);
    expect(resolved.user).toMatchObject({ id: BRUNO, first_name: BRUNO });
    expect(resolved.user).not.toHaveProperty("email");
    expect(resolved.keys).toMatchObject({
      userId: BRUNO,
      keyVersion: 1,
      fingerprint: fixture.fingerprint,
    });
    expect(resolved.own).toBe(false);
    expect((await codes.resolve(BRUNO, token)).own).toBe(true);
  });

  it("keep only the hash of the token", async () => {
    const { token } = await codes.issue(BRUNO);
    await sql`reset role`.execute(db);
    const rows = await sql<{
      token_hash: Uint8Array;
    }>`select token_hash from core.contact_codes`.execute(db);
    await sql`set role svc_gateway`.execute(db);
    expect(rows.rows).toHaveLength(1);
    expect(Buffer.from(rows.rows[0].token_hash)).toEqual(
      Buffer.from(secretTokenHash(token)),
    );
  });

  it("stop resolving after ten minutes, or once a new code replaces them", async () => {
    const first = await codes.issue(BRUNO);
    const second = await codes.issue(BRUNO);
    await expect(codes.resolve(MARIE, first.token)).rejects.toThrow(
      NotFoundError,
    );
    await codes.resolve(MARIE, second.token);
    clock.advance(CONTACT_CODE_TTL_MS);
    await expect(codes.resolve(MARIE, second.token)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("need keys to show, and resolve nothing that is not one of ours", async () => {
    await expect(codes.issue(NO_KEYS)).rejects.toThrow(NotFoundError);
    await expect(codes.resolve(MARIE, "nope")).rejects.toThrow(NotFoundError);
    await expect(codes.resolve(MARIE, "a".repeat(43))).rejects.toThrow(
      NotFoundError,
    );
  });

  it("are deleted by the retention once expired", async () => {
    await codes.issue(BRUNO);
    const repo = new KyselyContactCodeRepository(db);
    expect(await repo.deleteExpired(clock.now())).toBe(0);
    clock.advance(CONTACT_CODE_TTL_MS);
    expect(await repo.deleteExpired(clock.now())).toBe(1);
  });
});
