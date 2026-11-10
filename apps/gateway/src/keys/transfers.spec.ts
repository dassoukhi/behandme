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
import { KeyTransferService } from "./application/key-transfer.service.js";
import { KeysService } from "./application/keys.service.js";
import {
  type FactorVerificationAge,
  KEY_QUARANTINE_MS,
  ReverificationRequired,
} from "./domain/keys.js";
import { TRANSFER_WRAP_LENGTH } from "./domain/transfer.js";
import { KyselyKeyTransferRepository } from "./infrastructure/kysely-key-transfer.repository.js";
import { KyselyKeyRepository } from "./infrastructure/kysely-key.repository.js";
import { KyselyKeysUnitOfWork } from "./infrastructure/kysely-keys.unit-of-work.js";
import { nodeKeyCryptography } from "./infrastructure/node-key-cryptography.js";
import { keyPair } from "./testing/key-pair.js";
import fixture from "./testing/key-registration-v1.json" with { type: "json" };

// Keys from the old phone to a new one: the server relays a wrap it cannot open, for five minutes,
// between two sessions of one account. On the real schema (PGlite), as svc_gateway.
const ME = fixture.user_id;
const OTHER = "user_other";
const FRESH: FactorVerificationAge = [2, -1];
const b64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
const recipientKey = () => new Uint8Array(randomBytes(1216));
const wrap = () => {
  const bytes = new Uint8Array(randomBytes(TRANSFER_WRAP_LENGTH));
  bytes[0] = 0x01;
  return bytes;
};

let t: TestDatabase;
let db: Kysely<any>;
let clock: FakeClock;
let keys: KeysService;
let transfers: KeyTransferService;

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
  clock = new FakeClock(new Date("2026-11-10T09:00:00Z"));
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
  await keys.register(ME, {
    keyVersion: 1,
    kemPublicKey: b64(fixture.registration.kem_public_key),
    signingPublicKey: b64(fixture.registration.signing_public_key),
    signature: b64(fixture.registration.signature),
  });
  transfers = new KeyTransferService(
    new KyselyKeyTransferRepository(db),
    new KyselyKeysUnitOfWork(db),
    clock,
  );
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

/** The account's keys replaced behind the transfers' back (no reset: a reset ends them). */
const keysReplacedByHand = () =>
  asOwner(() =>
    sql`update core.user_keys set key_version = 2 where user_id = ${ME}`.execute(
      db,
    ),
  );

describe("opening a transfer", () => {
  it.each<[string, FactorVerificationAge | null]>([
    ["a session token without fva", null],
    ["a first factor verified long ago", [99999, -1]],
  ])("needs a fresh Clerk verification: %s", async (_case, fva) => {
    await expect(transfers.open(ME, recipientKey(), fva)).rejects.toThrow(
      ReverificationRequired,
    );
  });

  it("opens for five minutes, for the account's current keys", async () => {
    const opened = await transfers.open(ME, recipientKey(), FRESH);
    expect(opened).toMatchObject({
      key_version: 1,
      ready: false,
      expires_at: "2026-11-10T09:05:00.000Z",
    });
  });

  it("refuses a key that is not an X-Wing public key, and an account with nothing to move", async () => {
    await expect(transfers.open(ME, new Uint8Array(32), FRESH)).rejects.toThrow(
      InvalidInputError,
    );
    await expect(transfers.open(OTHER, recipientKey(), FRESH)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("replaces the user's transfer: the old code leads nowhere", async () => {
    const first = await transfers.open(ME, recipientKey(), FRESH);
    await transfers.open(ME, recipientKey(), FRESH);
    await expect(transfers.find(ME, first.id)).rejects.toThrow(NotFoundError);
    await expect(transfers.deposit(ME, first.id, 1, wrap())).rejects.toThrow(
      NotFoundError,
    );
  });

  it("keeps one transfer per account, even when two phones open at once", async () => {
    const opened = await Promise.all([
      transfers.open(ME, recipientKey(), FRESH),
      transfers.open(ME, recipientKey(), FRESH),
    ]);
    const { rows } = await asOwner(() =>
      sql<{
        id: string;
      }>`select id from core.key_transfers where user_id = ${ME}`.execute(db),
    );
    expect(rows).toHaveLength(1);
    expect(opened.map((o) => o.id)).toContain(rows[0].id);
    await expect(
      asOwner(() =>
        sql`insert into core.key_transfers (user_id, recipient_key, key_version, expires_at)
          values (${ME}, ${recipientKey()}, 1, now())`.execute(db),
      ),
    ).rejects.toThrow(/unique/);
  });
});

describe("moving the keys", () => {
  it("relays the old phone's wrap once, leaves nothing behind, and alerts the user", async () => {
    const key = recipientKey();
    const { id } = await transfers.open(ME, key, FRESH);
    const seen = await transfers.find(ME, id);
    expect(seen.recipient_key).toBe(Buffer.from(key).toString("base64"));

    const sent = wrap();
    expect(await transfers.deposit(ME, id, 1, sent)).toMatchObject({
      ready: true,
    });
    const ready = await transfers.find(ME, id);
    expect(ready.ready).toBe(true);
    expect(ready).not.toHaveProperty("wrap");
    expect(await transfers.take(ME, id)).toEqual({
      key_version: 1,
      wrap: Buffer.from(sent).toString("base64"),
    });
    expect(await outbox()).toEqual([["keys.transferred", { userId: ME }]]);

    await expect(transfers.take(ME, id)).rejects.toThrow(NotFoundError);
    await expect(transfers.find(ME, id)).rejects.toThrow(NotFoundError);
  });

  it("gives nothing before the old phone sent the keys", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await expect(transfers.take(ME, id)).rejects.toThrow(ConflictError);
    expect(await outbox()).toEqual([]);
  });

  it("takes the keys once, however many ask at the same moment", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await transfers.deposit(ME, id, 1, wrap());
    const results = await Promise.allSettled([
      transfers.take(ME, id),
      transfers.take(ME, id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });

  it("refuses a second wrap, a malformed one, and keys other than the account's", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await expect(
      transfers.deposit(ME, id, 1, new Uint8Array(100)),
    ).rejects.toThrow(InvalidInputError);
    await expect(transfers.deposit(ME, id, 2, wrap())).rejects.toThrow(
      ConflictError,
    );
    await transfers.deposit(ME, id, 1, wrap());
    await expect(transfers.deposit(ME, id, 1, wrap())).rejects.toThrow(
      ConflictError,
    );
  });

  it("moves only the account's current keys: changed meanwhile, the wrap would hold old ones", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await keysReplacedByHand();
    await expect(transfers.deposit(ME, id, 1, wrap())).rejects.toThrow(
      ConflictError,
    );
    await expect(transfers.deposit(ME, id, 2, wrap())).rejects.toThrow(
      ConflictError,
    );
  });

  it("does not hand over a wrap whose keys were replaced before it was taken", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await transfers.deposit(ME, id, 1, wrap());
    await keysReplacedByHand();
    await expect(transfers.take(ME, id)).rejects.toThrow(ConflictError);
    expect(await outbox()).toEqual([]);
  });

  it("ends with a key reset: the keys it would move are no longer the account's", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await transfers.deposit(ME, id, 1, wrap());
    await keys.reset(ME, keyPair()(ME, 2), FRESH);
    await expect(transfers.take(ME, id)).rejects.toThrow(NotFoundError);
  });

  it("is the user's alone: another account sees nothing of it", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await expect(transfers.find(OTHER, id)).rejects.toThrow(NotFoundError);
    await expect(transfers.deposit(OTHER, id, 1, wrap())).rejects.toThrow(
      NotFoundError,
    );
    await transfers.deposit(ME, id, 1, wrap());
    await expect(transfers.take(OTHER, id)).rejects.toThrow(NotFoundError);
  });

  it("is gone after five minutes, and the retention deletes it with its wrap", async () => {
    const { id } = await transfers.open(ME, recipientKey(), FRESH);
    await transfers.deposit(ME, id, 1, wrap());
    clock.advance(5 * 60_000);
    await expect(transfers.find(ME, id)).rejects.toThrow(NotFoundError);
    await expect(transfers.deposit(ME, id, 1, wrap())).rejects.toThrow(
      NotFoundError,
    );
    await expect(transfers.take(ME, id)).rejects.toThrow(NotFoundError);
    expect(
      await new KyselyKeyTransferRepository(db).deleteExpired(clock.now()),
    ).toBe(1);
  });

  it("is routed to the notifier, which alerts the user", async () => {
    const { rows } = await asOwner(() =>
      sql<{
        queue: string;
      }>`select queue from messaging.subscriptions where event_type = 'keys.transferred'`.execute(
        db,
      ),
    );
    expect(rows).toEqual([{ queue: "notifier" }]);
  });
});
