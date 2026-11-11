import { type Kysely, sql } from "kysely";
import { randomBytes } from "node:crypto";
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
import { KeyBackupService } from "./application/key-backup.service.js";
import { KeyCareService } from "./application/key-care.service.js";
import { KeysService } from "./application/keys.service.js";
import { toPublicKeys } from "./application/public-keys.js";
import {
  BACKUP_BOX_LENGTH,
  type KeyBackupSubmission,
} from "./domain/backup.js";
import { utcDay } from "./domain/care.js";
import {
  type FactorVerificationAge,
  KEY_QUARANTINE_MS,
  ReverificationRequired,
} from "./domain/keys.js";
import { KyselyKeyBackupRepository } from "./infrastructure/kysely-key-backup.repository.js";
import { KyselyKeyRepository } from "./infrastructure/kysely-key.repository.js";
import { KyselyKeysUnitOfWork } from "./infrastructure/kysely-keys.unit-of-work.js";
import { nodeKeyCryptography } from "./infrastructure/node-key-cryptography.js";
import { keyPair } from "./testing/key-pair.js";
import fixture from "./testing/key-registration-v1.json" with { type: "json" };

// The keys backed up in a passkey: the server keeps a box it cannot open, signed with the time by the keys in it,
// and hands it out to a session verified again a moment ago, alerting the user. On the real schema (PGlite), as
// svc_gateway.
const ME = fixture.user_id;
const OTHER = "user_other";
const FRESH: FactorVerificationAge = [2, -1];
const DAY = 86_400_000;
const CREDENTIAL = fixture.backup.credential_id;
const ANOTHER_PASSKEY = "b3RoZXItcGFzc2tleS1vZi10aGUtdXNlcg";
const b64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
const box = () => {
  const bytes = new Uint8Array(randomBytes(BACKUP_BOX_LENGTH));
  bytes[0] = 0x01;
  return bytes;
};
/** The backup the app made and signed (lib/crypto/passkeyBackup.ts in the app), from the shared fixture. */
const appBackup = (): KeyBackupSubmission => ({
  keyVersion: fixture.backup.key_version,
  credentialId: fixture.backup.credential_id,
  synced: fixture.backup.synced,
  madeAt: fixture.backup.made_at,
  box: b64(fixture.backup.box),
  signature: b64(fixture.backup.signature),
});

let t: TestDatabase;
let db: Kysely<any>;
let clock: FakeClock;
let keys: KeysService;
let care: KeyCareService;
let backups: KeyBackupService;

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`reset role`.execute(db);
  await sql`delete from public.users`.execute(db);
  await sql`delete from core.outbox`.execute(db);
  for (const id of [ME, OTHER]) {
    await sql`insert into public.users (id, email) values (${id}, ${id + "@x.fr"})`.execute(
      db,
    );
  }
  await sql`set role svc_gateway`.execute(db);
  // The time the app's fixture says it made its backup.
  clock = new FakeClock(new Date(fixture.backup.made_at));
  keys = new KeysService(
    new KyselyKeyRepository(db),
    nodeKeyCryptography,
    clock,
    new TrustService(
      new KyselyTrustRepository(db),
      new KyselyUsersUnitOfWork(db),
    ),
    new KyselyKeysUnitOfWork(db),
    { describe: async () => ({ name: null, trusterIds: [] }) },
    KEY_QUARANTINE_MS,
  );
  care = new KeyCareService(
    new KyselyKeyRepository(db),
    nodeKeyCryptography,
    clock,
  );
  backups = new KeyBackupService(
    new KyselyKeyBackupRepository(db),
    nodeKeyCryptography,
    new KyselyKeysUnitOfWork(db),
    clock,
  );
  await keys.register(ME, {
    keyVersion: 1,
    kemPublicKey: b64(fixture.registration.kem_public_key),
    signingPublicKey: b64(fixture.registration.signing_public_key),
    signature: b64(fixture.registration.signature),
  });
});
afterEach(() => sql`reset role`.execute(db));

/** As the database owner, for what svc_gateway may not do or see. */
const asOwner = async <T>(query: () => Promise<T>): Promise<T> => {
  await sql`reset role`.execute(db);
  try {
    return await query();
  } finally {
    await sql`set role svc_gateway`.execute(db);
  }
};

const outbox = () =>
  asOwner(async () => {
    const { rows } = await sql<{
      type: string;
      envelope: { payload: unknown };
    }>`select type, envelope from core.outbox`.execute(db);
    return rows.map((r) => [r.type, r.envelope.payload]);
  });

const storedBackups = () =>
  asOwner(async () => {
    const { rows } = await sql<{
      user_id: string;
      credential_id: string;
    }>`select user_id, credential_id from core.key_backups order by user_id`.execute(
      db,
    );
    return rows;
  });

/** Another account, with keys made here, and a backup of them made now. */
async function otherAccount() {
  const pair = keyPair();
  await keys.register(OTHER, pair(OTHER, 1));
  const backUp = (credentialId = CREDENTIAL, synced = true) =>
    pair.backUp(OTHER, 1, {
      credentialId,
      box: box(),
      madeAt: clock.now().toISOString(),
      synced,
    });
  return { pair, backUp };
}

describe("putting a backup in", () => {
  it("accepts the backup the app signs, and shows it to the user alone", async () => {
    await backups.put(ME, appBackup());
    expect((await care.mine(ME)).passkey_backup).toEqual({
      credential_id: CREDENTIAL,
      synced: true,
      made_at: fixture.backup.made_at,
    });
    const [mine] = await keys.visible(ME, [ME]);
    expect(JSON.stringify(toPublicKeys(mine))).not.toContain(CREDENTIAL);
  });

  it.each<[string, (b: KeyBackupSubmission) => void]>([
    ["another box", (b) => (b.box = box())],
    [
      "a passkey said to sync when the phone said otherwise",
      (b) => (b.synced = false),
    ],
    ["another passkey", (b) => (b.credentialId = ANOTHER_PASSKEY)],
    ["another time", (b) => (b.madeAt = "2026-11-11T09:00:01.000Z")],
    ["a changed signature", (b) => (b.signature[0] ^= 1)],
  ])("refuses what the keys did not sign: %s", async (_case, tamper) => {
    const backup = appBackup();
    tamper(backup);
    await expect(backups.put(ME, backup)).rejects.toThrow(
      new InvalidInputError("The backup's signature does not verify"),
    );
    expect(await storedBackups()).toEqual([]);
  });

  it("refuses a backup signed by other keys than the account's", async () => {
    const { pair } = await otherAccount();
    await expect(backups.put(OTHER, appBackup())).rejects.toThrow(
      InvalidInputError,
    );
    // Signed for this account by keys that are not its own.
    await expect(
      backups.put(
        ME,
        pair.backUp(ME, 1, {
          credentialId: CREDENTIAL,
          box: box(),
          madeAt: clock.now().toISOString(),
        }),
      ),
    ).rejects.toThrow(InvalidInputError);
  });

  it.each<[string, (b: KeyBackupSubmission) => void]>([
    ["a box of another length", (b) => (b.box = b.box.subarray(0, 61))],
    ["a box of another format", (b) => (b.box[0] = 0x02)],
    [
      "a credential id that is not base64url",
      (b) => (b.credentialId = "not a credential id!"),
    ],
    [
      "a credential id shorter than 16 bytes",
      (b) => (b.credentialId = "c2hvcnQ"),
    ],
    ["a short signature", (b) => (b.signature = new Uint8Array(10))],
    [
      "a time not written as the phone writes it",
      (b) => (b.madeAt = "2026-11-11T09:00:00Z"),
    ],
    [
      "a time that does not exist",
      (b) => (b.madeAt = "2026-02-30T09:00:00.000Z"),
    ],
  ])("refuses %s", async (_case, tamper) => {
    const backup = appBackup();
    tamper(backup);
    await expect(backups.put(ME, backup)).rejects.toThrow(InvalidInputError);
  });

  it("refuses a backup made more than a day from now: an old one sent again", async () => {
    clock.advance(DAY + 1);
    await expect(backups.put(ME, appBackup())).rejects.toThrow(
      new InvalidInputError("made_at must be the time of the backup"),
    );
    clock.advance(-2 * (DAY + 1));
    await expect(backups.put(ME, appBackup())).rejects.toThrow(
      InvalidInputError,
    );
    expect(await storedBackups()).toEqual([]);
  });

  it("replaces an older backup, never a newer one, whatever the order they come in", async () => {
    const { backUp } = await otherAccount();
    const older = backUp(CREDENTIAL);
    clock.advance(60_000);
    const newer = backUp(ANOTHER_PASSKEY, false);
    await backups.put(OTHER, newer);
    await expect(backups.put(OTHER, older)).rejects.toThrow(ConflictError);
    // The same backup sent twice (a retry) changes nothing and is not an error.
    await backups.put(OTHER, newer);
    expect((await care.mine(OTHER)).passkey_backup).toMatchObject({
      credential_id: ANOTHER_PASSKEY,
      synced: false,
    });
    expect(await storedBackups()).toHaveLength(1);
  });

  it("refuses a backup of keys that were replaced, and an account without keys", async () => {
    const { backUp } = await otherAccount();
    const ofOldKeys = backUp();
    await keys.reset(OTHER, keyPair()(OTHER, 2), FRESH);
    await expect(backups.put(OTHER, ofOldKeys)).rejects.toThrow(ConflictError);
    await asOwner(() =>
      sql`delete from core.user_keys where user_id = ${ME}`.execute(db),
    );
    await expect(backups.put(ME, appBackup())).rejects.toThrow(NotFoundError);
  });
});

describe("taking the backup out", () => {
  it.each<[string, FactorVerificationAge | null]>([
    ["a session token without fva", null],
    ["a first factor verified long ago", [99999, -1]],
  ])("needs a fresh Clerk verification: %s", async (_case, fva) => {
    await backups.put(ME, appBackup());
    await expect(backups.open(ME, CREDENTIAL, fva)).rejects.toThrow(
      ReverificationRequired,
    );
    expect(await outbox()).toEqual([]);
  });

  it("hands the box to the passkey that holds it, and alerts the user", async () => {
    await backups.put(ME, appBackup());
    expect(await backups.open(ME, CREDENTIAL, FRESH)).toEqual({
      key_version: 1,
      credential_id: CREDENTIAL,
      box: fixture.backup.box,
    });
    expect(await outbox()).toEqual([["keys.backup_opened", { userId: ME }]]);
  });

  it("gives nothing to another passkey, and alerts no one", async () => {
    await backups.put(ME, appBackup());
    await expect(backups.open(ME, ANOTHER_PASSKEY, FRESH)).rejects.toThrow(
      ConflictError,
    );
    expect(await outbox()).toEqual([]);
  });

  it("has nothing for another account, nor for an account without a backup", async () => {
    await backups.put(ME, appBackup());
    await expect(backups.open(OTHER, CREDENTIAL, FRESH)).rejects.toThrow(
      NotFoundError,
    );
    await backups.remove(ME, FRESH);
    await expect(backups.open(ME, CREDENTIAL, FRESH)).rejects.toThrow(
      NotFoundError,
    );
    expect(await outbox()).toEqual([]);
  });

  it("never hands out a backup of keys the account no longer has", async () => {
    await backups.put(ME, appBackup());
    // Keys replaced behind the backup's back (a reset deletes it).
    await asOwner(() =>
      sql`update core.user_keys set key_version = 2 where user_id = ${ME}`.execute(
        db,
      ),
    );
    await expect(backups.open(ME, CREDENTIAL, FRESH)).rejects.toThrow(
      NotFoundError,
    );
    expect((await care.mine(ME)).passkey_backup).toBeNull();
  });
});

describe("a reset of the keys", () => {
  it("deletes the backup of the keys it replaces", async () => {
    await backups.put(ME, appBackup());
    await keys.reset(ME, keyPair()(ME, 2), FRESH);
    expect(await storedBackups()).toEqual([]);
    expect((await care.mine(ME)).passkey_backup).toBeNull();
  });
});

describe("deleting the backup", () => {
  it("needs a fresh Clerk verification, then leaves no backup", async () => {
    await backups.put(ME, appBackup());
    await expect(backups.remove(ME, [99999, -1])).rejects.toThrow(
      ReverificationRequired,
    );
    expect(await storedBackups()).toHaveLength(1);
    await backups.remove(ME, FRESH);
    expect(await storedBackups()).toEqual([]);
    await expect(backups.remove(ME, FRESH)).rejects.toThrow(NotFoundError);
  });

  it("goes with the account", async () => {
    await backups.put(ME, appBackup());
    await asOwner(() =>
      sql`delete from public.users where id = ${ME}`.execute(db),
    );
    expect(await storedBackups()).toEqual([]);
  });
});

describe("the care of keys in a passkey", () => {
  const stateOf = async (id: string, fingerprint: string) =>
    (await care.validatorStates([id]))({ user_id: id, fingerprint });

  it("lets the owner of a contract count on a validator whose passkey syncs, with no phrase check", async () => {
    expect(await stateOf(ME, fixture.fingerprint)).toBe("not_saved");
    await backups.put(ME, appBackup());
    expect(await stateOf(ME, fixture.fingerprint)).toBe("ok");
  });

  it("counts on the passkey for 13 months after the phone last confirmed it", async () => {
    const { pair, backUp } = await otherAccount();
    const { fingerprint } = await keys.mine(OTHER);
    await backups.put(OTHER, backUp());
    clock.advance(397 * DAY);
    // The phone is in use (not silent), but has not opened the passkey for 13 months.
    await care.prove(OTHER, pair.prove(OTHER, 1, utcDay(clock.now())));
    expect(await stateOf(OTHER, fingerprint)).toBe("not_saved");
    await backups.put(OTHER, backUp());
    expect(await stateOf(OTHER, fingerprint)).toBe("ok");
  });

  it("goes on counting the checks of the phrase, which comes back on schedule without the passkey", async () => {
    const { backUp } = await otherAccount();
    await care.updatePhrase(OTHER, { keyVersion: 1, checked: true });
    await backups.put(OTHER, backUp());
    clock.advance(7 * DAY);
    // Not asked, with the passkey there; checked all the same: the second step of the schedule.
    expect((await care.mine(OTHER)).phrase_check_due).toBe(false);
    await care.updatePhrase(OTHER, { keyVersion: 1, checked: true });
    await backups.remove(OTHER, FRESH);
    // The third check is due 30 days after the second, not 7.
    clock.advance(8 * DAY);
    expect((await care.mine(OTHER)).phrase_check_due).toBe(false);
    clock.advance(22 * DAY);
    expect((await care.mine(OTHER)).phrase_check_due).toBe(true);
  });
});
