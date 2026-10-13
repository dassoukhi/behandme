import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { ContractService } from "../contracts/contract.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { UsersService } from "../users/users.service.js";
import { fakeSupabaseService } from "../testing/in-memory-supabase.js";

const OWNER = "user_owner";
const ACCESSOR = "user_accessor";
const VALIDATOR = "user_validator";
const STRANGER = "user_stranger";
const CONTRACT_ID = "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5";

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

function seed() {
  return {
    users: [OWNER, ACCESSOR, VALIDATOR, STRANGER].map(profile),
    // The accessor trusts the owner: the owner may see the accessor's contact details.
    trusted: [{ id: "t1", owner_id: ACCESSOR, trusted_id: OWNER }],
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
    notifications: [
      {
        id: "n1",
        userId: OWNER,
        title: "t",
        message: "m",
        is_read: false,
        data: {},
      },
      {
        id: "n2",
        userId: STRANGER,
        title: "t",
        message: "m",
        is_read: false,
        data: {},
      },
    ],
    push_tokens: [] as Record<string, any>[],
    orphan_tokens: [] as Record<string, any>[],
  };
}

let db: ReturnType<typeof seed>;
let contracts: ContractService;
let notifications: NotificationsService;
let users: UsersService;

beforeEach(() => {
  db = seed();
  const supabase = fakeSupabaseService(db);
  users = new UsersService(supabase);
  contracts = new ContractService(supabase, users);
  notifications = new NotificationsService(supabase);
});

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
    const trust = (owner: string, ...ids: string[]) =>
      ids.forEach((id, i) =>
        db.trusted.push({
          id: `t-${owner}-${i}`,
          owner_id: owner,
          trusted_id: id,
        }),
      );
    const body = {
      name: "devices" as const,
      accessor_id: OWNER,
      validators: [VALIDATOR],
    };

    it("always creates contracts owned by the caller, with no client-set status", async () => {
      trust(STRANGER, OWNER, VALIDATOR);
      const created = await contracts.create(STRANGER, body);
      expect(created.owner_id).toBe(STRANGER);
      expect(db.contracts.at(-1)).not.toHaveProperty("secret_hash");
      expect(db.contracts.at(-1)).not.toHaveProperty("status");
    });

    it("rejects participants the caller does not trust", async () => {
      trust(STRANGER, OWNER); // the validator is not trusted
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
      trust(STRANGER, OWNER, VALIDATOR, STRANGER);
      await expect(contracts.create(STRANGER, invalid)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});

describe("notifications: only the recipient", () => {
  it("lists only the caller's notifications", async () => {
    const list = await notifications.findAll(OWNER);
    expect(list.map((n) => n.id)).toEqual(["n1"]);
  });

  it.each([
    ["read", (me: string) => notifications.findOne(me, "n2")],
    [
      "mark as read",
      (me: string) => notifications.update(me, "n2", { is_read: true }),
    ],
    ["delete", (me: string) => notifications.remove(me, "n2")],
  ])("cannot %s someone else's notification", async (_action, act) => {
    await expect(act(OWNER)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.notifications.find((n) => n.id === "n2")).toMatchObject({
      is_read: false,
    });
  });

  it("can mark its own notification as read", async () => {
    await expect(
      notifications.update(OWNER, "n1", { is_read: true }),
    ).resolves.toMatchObject({
      is_read: true,
    });
  });

  it("moves a device token to whoever signs in on it", async () => {
    await notifications.registerOrphanToken({ token: "ExponentPushToken[a]" });
    await notifications.registerPushToken(STRANGER, {
      token: "ExponentPushToken[a]",
    });
    await notifications.registerPushToken(OWNER, {
      token: "ExponentPushToken[a]",
    });

    expect(db.push_tokens.map((t) => t.user_id)).toEqual([OWNER]);
    expect(db.orphan_tokens).toHaveLength(0);
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
    await users.updateMe(STRANGER, { first_name: "Changed" });
    expect(db.users.find((u) => u.id === STRANGER)?.first_name).toBe("Changed");
    expect(db.users.find((u) => u.id === OWNER)?.first_name).toBe(OWNER);
  });

  it("only trusts on behalf of the caller", async () => {
    const link = await users.addTrusted(STRANGER, { trusted_id: OWNER });
    expect(link.owner_id).toBe(STRANGER);
  });
});
