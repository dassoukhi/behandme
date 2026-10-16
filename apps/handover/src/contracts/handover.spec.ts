import { type Kysely, sql } from "kysely";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  systemClock,
} from "@lib/kernel";
import { startTestDatabase, type TestDatabase } from "@lib/testing";
import { ContractsService } from "./application/contracts.service.js";
import { HandoverEvents } from "./application/handover-events.js";
import { KyselyHandoverStores } from "./infrastructure/kysely-handover.stores.js";
import { nodeSha256 } from "./infrastructure/sha256.js";

// Handover's use cases on the real schema (PGlite), as svc_handover: role × action matrix, audit
// log written with each change, account deletion, nightly verification.
const OWNER = "user_owner";
const ACCESSOR = "user_accessor";
const VALIDATOR = "user_validator";
const STRANGER = "user_stranger";

let t: TestDatabase;
let db: Kysely<any>;
let stores: KyselyHandoverStores;
let contracts: ContractsService;
let events: HandoverEvents;
const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`
    reset role;
    alter table handover.contract_events disable trigger contract_events_no_truncate;
    truncate handover.contract_events;
    alter table handover.contract_events enable trigger contract_events_no_truncate;
    delete from handover.contracts;
    set role svc_handover;
  `.execute(db);
  stores = new KyselyHandoverStores(db);
  contracts = new ContractsService(stores, nodeSha256, systemClock);
  events = new HandoverEvents(nodeSha256);
  logger.error.mockReset();
});
afterEach(() => sql`reset role`.execute(db));

/** Runs statements as postgres (the table owner), then goes back to svc_handover. */
async function asOwner(...statements: ReturnType<typeof sql>[]) {
  await sql`reset role`.execute(db);
  for (const statement of statements) await statement.execute(db);
  await sql`set role svc_handover`.execute(db);
}

const newDraft = (owner = OWNER) =>
  contracts.create(owner, {
    category: "networks",
    description: "Mes réseaux",
    accessorId: ACCESSOR,
    validatorIds: [VALIDATOR],
  });

const types = async (id: string) =>
  (await contracts.events(OWNER, id).catch(() => [])).map((e) => e.type);

describe("contracts: role × action", () => {
  it("creates a draft owned by the caller, with its first audit event", async () => {
    const created = await newDraft();
    expect(created).toMatchObject({
      owner_id: OWNER,
      status: "draft",
      version: 1,
      accessor_id: ACCESSOR,
      validator_ids: [VALIDATOR],
      my_role: "owner",
      allowed_actions: ["update", "delete", "seal"],
    });
    const [event] = await contracts.events(OWNER, created.id);
    expect(event).toMatchObject({
      seq: 1,
      type: "contract.created",
      actor_id: OWNER,
      body: `{"accessor_id":"${ACCESSOR}","category":"networks","validator_ids":["${VALIDATOR}"]}`,
    });
  });

  it("refuses an invalid draft before writing anything", async () => {
    await expect(
      contracts.create(OWNER, {
        category: "networks",
        description: null,
        accessorId: OWNER,
        validatorIds: [VALIDATOR],
      }),
    ).rejects.toThrow(InvalidInputError);
    expect(await contracts.list(OWNER)).toEqual([]);
  });

  const roles = [
    ["owner", OWNER, { read: true, write: true }],
    ["accessor", ACCESSOR, { read: true, write: false }],
    ["validator", VALIDATOR, { read: true, write: false }],
    ["stranger", STRANGER, { read: false, write: false }],
  ] as const;

  describe.each(roles)("%s", (role, me, can) => {
    it(`${can.read ? "sees" : "does not see"} the contract`, async () => {
      const { id } = await newDraft();
      expect((await contracts.list(me)).map((c) => c.id)).toEqual(
        can.read ? [id] : [],
      );
      const read = contracts.get(me, id);
      if (can.read)
        await expect(read).resolves.toMatchObject({ my_role: role });
      else await expect(read).rejects.toThrow(NotFoundError);
    });

    it(`${can.read ? "reads" : "cannot read"} its audit log`, async () => {
      const { id } = await newDraft();
      const read = contracts.verify(me, id);
      if (can.read) await expect(read).resolves.toMatchObject({ ok: true });
      else await expect(read).rejects.toThrow(NotFoundError);
    });

    it(`${can.write ? "can" : "cannot"} edit and delete it`, async () => {
      const { id } = await newDraft();
      const update = contracts.update(me, id, { description: "Changée" });
      if (can.write) {
        await expect(update).resolves.toMatchObject({
          description: "Changée",
          version: 2,
        });
        await contracts.remove(me, id);
        await expect(contracts.get(me, id)).rejects.toThrow(NotFoundError);
      } else {
        await expect(update).rejects.toThrow(NotFoundError);
        await expect(contracts.remove(me, id)).rejects.toThrow(NotFoundError);
        expect((await contracts.get(OWNER, id)).description).toBe(
          "Mes réseaux",
        );
      }
    });
  });
});

describe("changes", () => {
  it("records the changed fields only, and nothing for a no-op", async () => {
    const { id } = await newDraft();
    await contracts.update(OWNER, id, {
      category: "networks",
      description: "Autre",
    });
    await contracts.update(OWNER, id, { description: "Autre" });
    const log = await contracts.events(OWNER, id);
    expect(log.map((e) => [e.type, e.body])).toEqual([
      ["contract.created", expect.any(String)],
      ["contract.updated", '{"fields":["description"]}'],
    ]);
  });

  it("refuses a change made on an older version", async () => {
    const { id } = await newDraft();
    await asOwner(
      sql`update handover.contracts set version = 5 where id = ${id}::uuid`,
    );
    // The service reads version 5 and writes against it: no conflict.
    await expect(
      contracts.update(OWNER, id, { description: "Après" }),
    ).resolves.toMatchObject({ version: 6 });
    // A write against an outdated version is refused by the repository.
    await expect(
      stores.transaction((s) =>
        s.contracts.update(id, { description: "Trop tard" }, 5),
      ),
    ).resolves.toBeNull();
  });

  it("only deletes a draft", async () => {
    const { id } = await newDraft();
    await asOwner(
      sql`update handover.contracts set status = 'active' where id = ${id}::uuid`,
    );
    await expect(contracts.remove(OWNER, id)).rejects.toThrow(ConflictError);
  });

  it("keeps the log of a deleted draft, ending with its deletion", async () => {
    const { id } = await newDraft();
    await contracts.remove(OWNER, id);
    const log = await stores.root.audit.list(id);
    expect(log.map((e) => e.type)).toEqual([
      "contract.created",
      "contract.deleted",
    ]);
    expect(log[1].body).toBe('{"reason":"owner"}');
  });

  it("writes nothing when the transaction fails after the change", async () => {
    const { id } = await newDraft();
    await expect(
      stores.transaction(async (s) => {
        await s.audit.append(id, OWNER, { type: "contract.updated", body: {} });
        throw new Error("later step failed");
      }),
    ).rejects.toThrow("later step failed");
    expect(await types(id)).toEqual(["contract.created"]);
  });
});

describe("events from other services", () => {
  it("deletes the drafts of a deleted account, and only them", async () => {
    const mine = await newDraft();
    const other = await newDraft(STRANGER);
    const deleted = await stores.transaction((s) =>
      events.userDeleted(s, OWNER),
    );
    expect(deleted).toBe(1);
    await expect(contracts.get(OWNER, mine.id)).rejects.toThrow(NotFoundError);
    expect((await stores.root.audit.list(mine.id)).at(-1)).toMatchObject({
      type: "contract.deleted",
      actor_id: null,
      body: '{"reason":"account_deleted"}',
    });
    await expect(contracts.get(STRANGER, other.id)).resolves.toBeDefined();
  });

  it("verifies every chain and reports a tampered one", async () => {
    const a = await newDraft();
    const b = await newDraft();
    await contracts.update(OWNER, b.id, { description: "x" });
    expect(await events.verifyAll(stores.root, logger)).toEqual({
      checked: 2,
      broken: [],
    });

    // Someone with the table owner's rights edits history, triggers off.
    await asOwner(
      sql`alter table handover.contract_events disable trigger contract_events_no_update_delete`,
      sql`update handover.contract_events set body = '{"fields":[]}' where contract_id = ${b.id}::uuid and seq = 2`,
      sql`alter table handover.contract_events enable trigger contract_events_no_update_delete`,
    );

    expect(await events.verifyAll(stores.root, logger)).toEqual({
      checked: 2,
      broken: [b.id],
    });
    expect(logger.error).toHaveBeenCalledWith(
      `Audit log of contract ${b.id} is broken at event 2`,
    );
    await expect(contracts.verify(OWNER, a.id)).resolves.toMatchObject({
      ok: true,
    });
    await expect(contracts.verify(VALIDATOR, b.id)).resolves.toMatchObject({
      ok: false,
      broken_at: 2,
    });
  });
});
