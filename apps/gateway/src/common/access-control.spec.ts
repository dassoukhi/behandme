import { BadRequestException, NotFoundException } from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { NotFoundError, UnprocessableError } from "@lib/kernel";
import { startTestDatabase, type TestDatabase } from "@lib/testing";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ContractService } from "../contracts/contract.service.js";
import type { IdentityProfile } from "../users/application/ports.js";
import { ProfileService } from "../users/application/profile.service.js";
import { TrustService } from "../users/application/trust.service.js";
import { KyselyProfileRepository } from "../users/infrastructure/kysely-profile.repository.js";
import { KyselyTrustRepository } from "../users/infrastructure/kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "../users/infrastructure/kysely-users.unit-of-work.js";
import { fakeSupabaseService } from "../testing/in-memory-supabase.js";

// The real services. Profiles and trust links on the real schema (PGlite, as svc_gateway);
// contracts, still read through supabase-js, on an in-memory Supabase.

const OWNER = "user_owner";
const ACCESSOR = "user_accessor";
const VALIDATOR = "user_validator";
const STRANGER = "user_stranger";
const CONTRACT_ID = "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5";
const PEOPLE = [OWNER, ACCESSOR, VALIDATOR, STRANGER];

const profile = (id: string) => ({
  id,
  email: `${id}@example.com`,
  phone_number: "+33600000000",
  first_name: id,
  last_name: "Test",
  avatar_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

function seedContracts() {
  return {
    users: PEOPLE.map(profile),
    contracts: [
      {
        id: CONTRACT_ID,
        name: "networks",
        description: "desc",
        owner_id: OWNER,
        accessor_id: ACCESSOR,
        validators: [VALIDATOR],
        // Legacy columns still present in the hosted table: never returned.
        secret_hash: "s3cret",
        blockchain_tx_id: "0x1",
        blockchain_network: "Fabric-Network",
        meta: { note: "private" },
        status: "draft",
        // Joined relations, as returned by the real select.
        owner: profile(OWNER),
        accessor: profile(ACCESSOR),
      },
    ],
  };
}

let t: TestDatabase;
let pg: Kysely<any>;
let db: ReturnType<typeof seedContracts>;
let contracts: ContractService;
let users: ProfileService;
let trust: TrustService;
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
    delete from public.trusted; delete from public.contracts; delete from public.users;
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

  db = seedContracts();
  identities = {};
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
  );
  contracts = new ContractService(fakeSupabaseService(db), trust);
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

  describe.each(roles)("%s", (_role, me, can) => {
    it(`${can.read ? "sees" : "does not see"} the contract in the list`, async () => {
      const list = await contracts.findAll(me);
      expect(list.map((c) => c.id)).toEqual(can.read ? [CONTRACT_ID] : []);
    });

    it(`${can.read ? "can" : "cannot"} read it (404 otherwise)`, async () => {
      const read = contracts.findOne(me, CONTRACT_ID);
      if (can.read)
        await expect(read).resolves.toMatchObject({ id: CONTRACT_ID });
      else await expect(read).rejects.toBeInstanceOf(NotFoundException);
    });

    it(`${can.write ? "can" : "cannot"} update it`, async () => {
      const update = contracts.update(me, CONTRACT_ID, {
        description: "changed",
      });
      if (can.write)
        await expect(update).resolves.toMatchObject({ description: "changed" });
      else {
        await expect(update).rejects.toBeInstanceOf(NotFoundException);
        expect(db.contracts[0].description).toBe("desc");
      }
    });

    it(`${can.write ? "can" : "cannot"} delete it`, async () => {
      const remove = contracts.remove(me, CONTRACT_ID);
      if (can.write) await expect(remove).resolves.toBeDefined();
      else {
        await expect(remove).rejects.toBeInstanceOf(NotFoundException);
        expect(db.contracts).toHaveLength(1);
      }
    });
  });

  it("never returns secret material or legacy columns, even to the owner", async () => {
    const views = [
      await contracts.findOne(OWNER, CONTRACT_ID),
      await contracts.findOne(ACCESSOR, CONTRACT_ID),
      (await contracts.findAll(VALIDATOR))[0],
      await contracts.update(OWNER, CONTRACT_ID, { description: "x" }),
    ];
    for (const view of views) {
      for (const column of [
        "secret_hash",
        "blockchain_tx_id",
        "blockchain_network",
        "meta",
      ]) {
        expect(view).not.toHaveProperty(column);
      }
    }
  });

  it("applies the profile visibility rule to joined users", async () => {
    const asOwner = await contracts.findOne(OWNER, CONTRACT_ID);
    // The accessor trusts the owner; the validator does not.
    expect(asOwner.accessor?.email).toBe(`${ACCESSOR}@example.com`);
    expect(asOwner.validators_list[0]).not.toHaveProperty("email");

    const asValidator = await contracts.findOne(VALIDATOR, CONTRACT_ID);
    expect(asValidator.owner).not.toHaveProperty("email");
    expect(asValidator.validators_list[0].email).toBe(
      `${VALIDATOR}@example.com`,
    );
  });

  describe("creation", () => {
    const body = {
      name: "devices" as const,
      accessor_id: OWNER,
      validators: [VALIDATOR],
    };

    it("always creates contracts owned by the caller, with no client-set status", async () => {
      await trusts(STRANGER, OWNER, VALIDATOR);
      const created = await contracts.create(STRANGER, body);
      expect(created.owner_id).toBe(STRANGER);
      expect(db.contracts.at(-1)).not.toHaveProperty("secret_hash");
      expect(db.contracts.at(-1)).not.toHaveProperty("status");
    });

    it("rejects participants the caller does not trust", async () => {
      await trusts(STRANGER, OWNER); // the validator is not trusted
      await expect(contracts.create(STRANGER, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.contracts).toHaveLength(1);
    });

    it.each([
      ["the caller as accessor", { ...body, accessor_id: STRANGER }],
      ["the caller as validator", { ...body, validators: [STRANGER] }],
      ["the accessor as validator", { ...body, validators: [OWNER] }],
    ])("rejects %s", async (_case, invalid) => {
      // Even trusting oneself (only possible in the data) does not make it valid.
      await trusts(STRANGER, OWNER, VALIDATOR, STRANGER);
      await expect(contracts.create(STRANGER, invalid)).rejects.toBeInstanceOf(
        BadRequestException,
      );
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
    await trusts(OWNER, VALIDATOR);
    const listed = await trust.listTrusted(OWNER);
    expect(listed.map((p) => p.id)).toEqual([VALIDATOR]);
    expect(listed[0]).not.toHaveProperty("email");
  });
});
