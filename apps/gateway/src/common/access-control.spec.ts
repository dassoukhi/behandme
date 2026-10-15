import { type Kysely, sql } from "kysely";
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ContractsFacade } from "../contracts/application/contracts.facade.js";
import { KeysService } from "../keys/application/keys.service.js";
import { KyselyKeyRepository } from "../keys/infrastructure/kysely-key.repository.js";
import { nodeKeyCryptography } from "../keys/infrastructure/node-key-cryptography.js";
import { InMemoryHandover } from "../handover/testing/in-memory-handover.js";
import type { IdentityProfile } from "../users/application/ports.js";
import { ProfileService } from "../users/application/profile.service.js";
import { TrustService } from "../users/application/trust.service.js";
import { HandoverParticipation } from "../users/infrastructure/handover-participation.js";
import { KyselyProfileRepository } from "../users/infrastructure/kysely-profile.repository.js";
import { KyselyTrustRepository } from "../users/infrastructure/kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "../users/infrastructure/kysely-users.unit-of-work.js";

// The real gateway services: profiles and trust links on the real schema (PGlite, as svc_gateway);
// contracts through the handover client, here an in-memory stand-in (handover's own rules are
// tested in apps/handover).

const OWNER = "user_owner";
const ACCESSOR = "user_accessor";
const VALIDATOR = "user_validator";
const STRANGER = "user_stranger";
const PEOPLE = [OWNER, ACCESSOR, VALIDATOR, STRANGER];

const profile = (id: string) => ({
  id,
  email: `${id}@example.com`,
  phone_number: "+33600000000",
  first_name: id,
  last_name: "Test",
});

let t: TestDatabase;
let pg: Kysely<any>;
let handover: InMemoryHandover;
let contracts: ContractsFacade;
let users: ProfileService;
let trust: TrustService;
let contractId: string;
let keys: KeysService;
// What Clerk would return for each user id (the only trusted source of emails).
let identities: Record<string, IdentityProfile>;

/** `owner` trusts each of `ids`. */
const trusts = (owner: string, ...ids: string[]) =>
  Promise.all(ids.map((id) => new KyselyTrustRepository(pg).add(owner, id)));

beforeAll(async () => {
  t = await startTestDatabase();
  pg = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`
    reset role;
    delete from public.trusted; delete from public.users;
    delete from core.outbox;
  `.execute(pg);
  for (const p of PEOPLE.map(profile)) {
    await sql`insert into public.users (id, email, phone_number, first_name, last_name)
      values (${p.id}, ${p.email}, ${p.phone_number}, ${p.first_name}, ${p.last_name})`.execute(
      pg,
    );
  }
  // The rights the gateway has in production.
  await sql`set role svc_gateway`.execute(pg);
  // The accessor trusts the owner: the owner may see the accessor's contact details.
  await trusts(ACCESSOR, OWNER);
  await trusts(OWNER, ACCESSOR, VALIDATOR);

  identities = {};
  handover = new InMemoryHandover();
  const unitOfWork = new KyselyUsersUnitOfWork(pg);
  trust = new TrustService(new KyselyTrustRepository(pg), unitOfWork);
  users = new ProfileService(
    new KyselyProfileRepository(pg),
    {
      getProfile: async (id: string) => {
        if (!identities[id]) throw new Error(`unknown identity ${id}`);
        return identities[id];
      },
    },
    trust,
    unitOfWork,
    new HandoverParticipation(handover),
  );
  keys = new KeysService(
    new KyselyKeyRepository(pg),
    nodeKeyCryptography,
    new FakeClock(),
    trust,
  );
  contracts = new ContractsFacade(handover, users, trust, keys);
  contractId = (
    await contracts.create(OWNER, {
      category: "networks",
      description: "desc",
      accessor_id: ACCESSOR,
      validator_ids: [VALIDATOR],
    })
  ).id;
});
afterEach(() => sql`reset role`.execute(pg));

const outboxTypes = async () =>
  (
    await sql<{ type: string }>`select type from core.outbox`.execute(pg)
  ).rows.map((r) => r.type);

describe("contracts: role × action", () => {
  const roles = [
    ["owner", OWNER, { read: true, write: true }],
    ["accessor", ACCESSOR, { read: true, write: false }],
    ["validator", VALIDATOR, { read: true, write: false }],
    ["stranger", STRANGER, { read: false, write: false }],
  ] as const;

  describe.each(roles)("%s", (role, me, can) => {
    it(`${can.read ? "sees" : "does not see"} the contract, with their role`, async () => {
      const list = await contracts.list(me);
      expect(list.map((c) => [c.id, c.my_role])).toEqual(
        can.read ? [[contractId, role]] : [],
      );
      const read = contracts.get(me, contractId);
      if (can.read)
        await expect(read).resolves.toMatchObject({ my_role: role });
      else await expect(read).rejects.toThrow(NotFoundError);
    });

    it(`${can.write ? "can" : "cannot"} change or delete it`, async () => {
      const update = contracts.update(me, contractId, { description: "x" });
      if (can.write) {
        await expect(update).resolves.toMatchObject({ description: "x" });
        await contracts.remove(me, contractId);
      } else {
        await expect(update).rejects.toThrow(NotFoundError);
        await expect(contracts.remove(me, contractId)).rejects.toThrow(
          NotFoundError,
        );
      }
    });

    it(`${can.read ? "reads" : "cannot read"} the audit log`, async () => {
      const read = contracts.events(me, contractId);
      if (can.read) await expect(read).resolves.toEqual([]);
      else await expect(read).rejects.toThrow(NotFoundError);
    });
  });

  it("calls handover for the caller only", async () => {
    await contracts.list(VALIDATOR);
    expect(handover.calls.at(-1)).toMatchObject({
      method: "list",
      userId: VALIDATOR,
    });
  });

  it("applies the profile visibility rule to the participants", async () => {
    const asOwner = await contracts.get(OWNER, contractId);
    // The accessor trusts the owner; the validator does not.
    expect(asOwner.accessor?.email).toBe(`${ACCESSOR}@example.com`);
    expect(asOwner.validators_list[0]).not.toHaveProperty("email");

    const asValidator = await contracts.get(VALIDATOR, contractId);
    // The owner trusts every participant, so they all see the owner's details…
    expect(asValidator.owner?.email).toBe(`${OWNER}@example.com`);
    // …but not each other's, unless they trust each other.
    expect(asValidator.accessor).not.toHaveProperty("email");
    expect(asValidator.validators_list[0].email).toBe(
      `${VALIDATOR}@example.com`,
    );
  });

  describe("creation", () => {
    const body = {
      category: "devices" as const,
      accessor_id: OWNER,
      validator_ids: [VALIDATOR],
    };

    it("creates the contract for the caller once its participants are trusted", async () => {
      await trusts(STRANGER, OWNER, VALIDATOR);
      const created = await contracts.create(STRANGER, body);
      expect(created).toMatchObject({ owner_id: STRANGER, my_role: "owner" });
      expect(created.validators_list.map((p) => p.id)).toEqual([VALIDATOR]);
    });

    it("rejects participants the caller does not trust, without calling handover", async () => {
      await trusts(STRANGER, OWNER); // the validator is not trusted
      const before = handover.contracts.length;
      await expect(contracts.create(STRANGER, body)).rejects.toThrow(
        new InvalidInputError(
          "Accessor and validators must be people you trust",
        ),
      );
      expect(handover.contracts).toHaveLength(before);
    });

    it("leaves the caller-as-participant rule to handover", async () => {
      await trusts(STRANGER, OWNER, VALIDATOR);
      await expect(
        contracts.create(STRANGER, { ...body, accessor_id: STRANGER }),
      ).rejects.toThrow(/own contract/);
    });
  });
});

describe("users: profile visibility", () => {
  it("returns contact details to users the profile owner trusts", async () => {
    // ACCESSOR trusts OWNER
    expect((await users.findOne(OWNER, ACCESSOR)).email).toBe(
      `${ACCESSOR}@example.com`,
    );
  });

  it("hides contact details from everyone else", async () => {
    const seen = await users.findOne(STRANGER, ACCESSOR);
    expect(seen).not.toHaveProperty("email");
    expect(seen).not.toHaveProperty("phone_number");
    expect(seen.first_name).toBe(ACCESSOR);
  });

  it("only updates the caller's own profile", async () => {
    await users.updateMe(STRANGER, { phone_number: "+33700000000" });
    expect((await users.findMe(STRANGER)).phone_number).toBe("+33700000000");
    expect((await users.findMe(OWNER)).phone_number).toBe("+33600000000");
  });

  it("refuses to delete someone who takes part in another's contract", async () => {
    await expect(users.removeMe(VALIDATOR)).rejects.toThrow(ConflictError);
    expect((await users.findMe(VALIDATOR)).id).toBe(VALIDATOR);
    expect(await outboxTypes()).toEqual([]);
  });

  it("only deletes the caller's own profile, and tells the other services", async () => {
    await users.removeMe(STRANGER);
    await expect(users.findMe(STRANGER)).rejects.toBeInstanceOf(NotFoundError);
    expect((await users.findMe(OWNER)).id).toBe(OWNER);
    expect(await outboxTypes()).toEqual(["user.deleted"]);
  });

  describe("profile provisioning", () => {
    const NEW_USER = "user_newcomer";
    const identity = (email: string | null): IdentityProfile => ({
      email,
      first_name: "Nina",
      last_name: "Nouvelle",
      avatar_url: "https://img.clerk.com/a.png",
    });

    it("creates the profile with the email verified by Clerk", async () => {
      identities[NEW_USER] = identity("nina@example.com");
      const { profile, created } = await users.ensureMe(NEW_USER);
      expect(created).toBe(true);
      expect(profile).toMatchObject({
        id: NEW_USER,
        email: "nina@example.com",
      });
    });

    it("is idempotent and resyncs the email from Clerk", async () => {
      identities[NEW_USER] = identity("nina@example.com");
      await users.ensureMe(NEW_USER);
      identities[NEW_USER] = identity("nina.new@example.com");
      const { profile, created } = await users.ensureMe(NEW_USER, {
        first_name: "Nina-Rose",
      });
      expect(created).toBe(false);
      expect(profile).toMatchObject({
        email: "nina.new@example.com",
        first_name: "Nina-Rose",
      });
      const { rows } =
        await sql`select 1 from public.users where id = ${NEW_USER}`.execute(
          pg,
        );
      expect(rows).toHaveLength(1);
    });

    it("refuses an account without a verified email", async () => {
      identities[NEW_USER] = identity(null);
      await expect(users.ensureMe(NEW_USER)).rejects.toBeInstanceOf(
        UnprocessableError,
      );
      await expect(users.findMe(NEW_USER)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});

describe("trust links: only the caller's own", () => {
  it("only trusts on behalf of the caller, and tells the person added", async () => {
    const link = await trust.add(STRANGER, OWNER);
    expect(link.owner_id).toBe(STRANGER);
    expect(await outboxTypes()).toEqual(["trust.added"]);
  });

  it("removes the caller's own link only (404 for someone else's)", async () => {
    // ACCESSOR trusts OWNER; the owner and a stranger cannot remove that link.
    await expect(trust.remove(OWNER, OWNER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(trust.remove(STRANGER, OWNER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await trust.trustedIds(ACCESSOR)).toEqual(new Set([OWNER]));

    await trust.remove(ACCESSOR, OWNER);
    expect(await trust.trustedIds(ACCESSOR)).toEqual(new Set());
  });

  it("lists who trusts the caller, with their contact details", async () => {
    const asOwner = await trust.listTrustedBy(OWNER);
    expect(asOwner.map((p) => p.id)).toEqual([ACCESSOR]);
    expect(asOwner[0].email).toBe(`${ACCESSOR}@example.com`);
    expect(await trust.listTrustedBy(STRANGER)).toEqual([]);
  });

  it("lists who the caller trusts, hiding contact details of those who do not trust back", async () => {
    const listed = await trust.listTrusted(OWNER);
    expect(listed.map((p) => p.id).sort()).toEqual([ACCESSOR, VALIDATOR]);
    expect(listed.find((p) => p.id === ACCESSOR)?.email).toBe(
      `${ACCESSOR}@example.com`,
    );
    expect(listed.find((p) => p.id === VALIDATOR)).not.toHaveProperty("email");
  });
});

describe("public keys: who may read them", () => {
  it("shows a user's keys to them and to people linked by trust, not to strangers", async () => {
    await sql`reset role`.execute(pg);
    await sql`insert into core.user_keys (user_id, key_version, kem_public_key, signing_public_key, fingerprint, signature, usable_from)
      values (${ACCESSOR}, 1, ${new Uint8Array(1216)}, ${new Uint8Array(32)}, ${"0".repeat(64)}, ${new Uint8Array(64)}, now())`.execute(
      pg,
    );
    await sql`set role svc_gateway`.execute(pg);
    // ACCESSOR trusts OWNER, and OWNER trusts ACCESSOR: both ways linked; STRANGER is not.
    for (const [viewer, sees] of [
      [ACCESSOR, true],
      [OWNER, true],
      [STRANGER, false],
    ] as const) {
      const visible = await keys.visible(viewer, [ACCESSOR]);
      expect(visible.map((k) => k.userId)).toEqual(sees ? [ACCESSOR] : []);
    }
  });
});

describe("sealing: who may, with whose keys", () => {
  const sealing = (accessor = ACCESSOR) => ({
    expected_version: 1,
    accessor_id: accessor,
    validator_ids: [VALIDATOR],
    envelope: "AQ==",
    owner_wrap: "AQ==",
    shares: [{ user_id: VALIDATOR, index: 1, key_version: 1, wrap: "AQ==" }],
    manifest: {},
    manifest_signature: "AA==",
  });
  /** Registers placeholder keys for these users, as if they had activated them in the app. */
  async function withKeys(...ids: string[]) {
    await sql`reset role`.execute(pg);
    for (const id of ids) {
      await sql`insert into core.user_keys (user_id, key_version, kem_public_key, signing_public_key, fingerprint, signature, usable_from)
        values (${id}, 1, ${new Uint8Array(1216)}, ${new Uint8Array(32).fill(id.length)}, ${"a".repeat(64)}, ${new Uint8Array(64)}, now())`.execute(
        pg,
      );
    }
    await sql`set role svc_gateway`.execute(pg);
  }

  it("passes handover the registered keys of the owner and every participant, from the database", async () => {
    await withKeys(OWNER, ACCESSOR, VALIDATOR);
    await contracts.seal(OWNER, contractId, sealing());
    expect(handover.sealedWith?.keys.map((k) => k.user_id).sort()).toEqual(
      [ACCESSOR, OWNER, VALIDATOR].sort(),
    );
    expect(handover.sealedWith?.keys[0]).toMatchObject({
      key_version: 1,
      fingerprint: "a".repeat(64),
    });
  });

  it("refuses while someone has not activated their keys, naming them", async () => {
    await withKeys(OWNER, ACCESSOR);
    await expect(contracts.seal(OWNER, contractId, sealing())).rejects.toThrow(
      `missing: ${VALIDATOR}`,
    );
    expect(handover.sealedWith).toBeNull();
  });

  it("refuses participants the owner does not trust", async () => {
    await withKeys(OWNER, ACCESSOR, VALIDATOR, STRANGER);
    await expect(
      contracts.seal(OWNER, contractId, sealing(STRANGER)),
    ).rejects.toThrow(InvalidInputError);
  });

  it.each([ACCESSOR, VALIDATOR, STRANGER])(
    "is not possible for %s",
    async (who) => {
      await withKeys(OWNER, ACCESSOR, VALIDATOR);
      await trusts(who, ACCESSOR, VALIDATOR);
      await expect(
        contracts.seal(who, contractId, sealing()),
      ).rejects.toThrow();
      expect(handover.sealedWith).toBeNull();
    },
  );
});
