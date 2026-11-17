import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "@lib/testing";
import { KyselyInvitationRepository } from "./kysely-invitation.repository.js";
import { KyselyProfileRepository } from "./kysely-profile.repository.js";
import { KyselyTrustRepository } from "./kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "./kysely-users.unit-of-work.js";

// The adapters on the real schema (migrations replayed on PGlite), as svc_gateway: the rights the
// gateway has in production.
let t: TestDatabase;
beforeAll(async () => {
  t = await startTestDatabase();
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`
    delete from core.invitations;
    delete from public.trusted; delete from public.users;
    delete from core.outbox;
    insert into public.users (id, email, first_name, last_name) values
      ('u1', 'alice.martin@example.com', 'Alice', 'Durand'),
      ('u2', 'bob@example.com', 'Bob', 'Durand'),
      ('u3', 'promo@example.com', '50%_off', 'Durand');
  `.execute(t.db);
});

const asGateway = <T>(work: (db: Kysely<any>) => Promise<T>) =>
  t.asRole("svc_gateway", work);

const DAY = 24 * 60 * 60_000;

describe("invitations", () => {
  const repo = (db: Kysely<any>) => new KyselyInvitationRepository(db);
  const now = new Date("2026-11-15T10:00:00.000Z");
  const later = (ms: number) => new Date(now.getTime() + ms);
  const hash = (n: number) => new Uint8Array(32).fill(n);
  const invite = (n: number, expiresAt = later(DAY)) =>
    asGateway((db) =>
      repo(db).create({ inviterId: "u1", tokenHash: hash(n), expiresAt }),
    );

  it("finds an invitation by the hash of its token only", async () => {
    const created = await invite(1);
    const found = await asGateway((db) => repo(db).findByToken(hash(1)));
    expect(found).toEqual(created);
    expect(found).toMatchObject({
      inviterId: "u1",
      acceptedBy: null,
      acceptedAt: null,
      cancelledAt: null,
    });
    expect(await asGateway((db) => repo(db).findByToken(hash(2)))).toBeNull();
  });

  it("is accepted once, and no longer pending then", async () => {
    const { id } = await invite(1);
    expect(await asGateway((db) => repo(db).accept(id, "u2", now))).toBe(true);
    expect(await asGateway((db) => repo(db).accept(id, "u3", now))).toBe(false);
    expect(
      await asGateway((db) => repo(db).findByToken(hash(1))),
    ).toMatchObject({ acceptedBy: "u2", acceptedAt: now });
    expect(await asGateway((db) => repo(db).pending("u1", now))).toEqual([]);
  });

  it("is cancelled by its inviter only, and then cannot be accepted", async () => {
    const { id } = await invite(1);
    expect(await asGateway((db) => repo(db).cancel("u2", id, now))).toBe(false);
    expect(await asGateway((db) => repo(db).cancel("u1", id, now))).toBe(true);
    expect(await asGateway((db) => repo(db).accept(id, "u2", now))).toBe(false);
  });

  it("lists the pending ones newest first, leaving out the expired", async () => {
    const old = await invite(1);
    await sql`update core.invitations set created_at = created_at - interval '1 hour' where id = ${old.id}`.execute(
      t.db,
    );
    const recent = await invite(2);
    await invite(3, later(-1));
    expect(
      (await asGateway((db) => repo(db).pending("u1", now))).map((i) => i.id),
    ).toEqual([recent.id, old.id]);
    expect(
      await asGateway((db) => repo(db).accept(old.id, "u2", later(2 * DAY))),
    ).toBe(false);
  });

  it("goes with the inviter's account, and forgets a deleted invitee", async () => {
    const { id } = await invite(1);
    await asGateway((db) => repo(db).accept(id, "u2", now));
    await sql`delete from public.users where id = 'u2'`.execute(t.db);
    expect(
      await asGateway((db) => repo(db).findByToken(hash(1))),
    ).toMatchObject({ acceptedBy: null });
    await sql`delete from public.users where id = 'u1'`.execute(t.db);
    expect(await asGateway((db) => repo(db).findByToken(hash(1)))).toBeNull();
  });

  it("deletes those that expired before a date, whatever their state", async () => {
    await invite(1, later(-2 * DAY));
    const { id } = await invite(2, later(-2 * DAY));
    await asGateway((db) => repo(db).cancel("u1", id, later(-3 * DAY)));
    await invite(3, later(DAY));
    expect(
      await asGateway((db) => repo(db).deleteExpiredBefore(later(-DAY))),
    ).toBe(2);
    expect(
      await asGateway((db) => repo(db).findByToken(hash(3))),
    ).not.toBeNull();
  });

  it("routes invitation.accepted to the notifier, which tells the inviter", async () => {
    const { rows } = await sql<{
      queue: string;
    }>`select queue from messaging.subscriptions where event_type = 'invitation.accepted'`.execute(
      t.db,
    );
    expect(rows).toEqual([{ queue: "notifier" }]);
  });

  // The lock itself needs two connections, which PGlite does not have: this checks the query runs in a transaction.
  it("reads the invitation to accept with a row lock inside a transaction", async () => {
    await invite(1);
    const found = await asGateway((db) =>
      db.transaction().execute((tx) => repo(tx).findByTokenForUpdate(hash(1))),
    );
    expect(found?.inviterId).toBe("u1");
  });
});

describe("profiles", () => {
  it("returns timestamps as ISO strings and refreshes updated_at", async () => {
    const before = await asGateway((db) =>
      new KyselyProfileRepository(db).find("u1"),
    );
    expect(before?.created_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    const after = await asGateway((db) =>
      new KyselyProfileRepository(db).update("u1", { phone_number: "+33" }),
    );
    expect(after).toMatchObject({ id: "u1", phone_number: "+33" });
    expect(
      await asGateway((db) => new KyselyProfileRepository(db).update("x", {})),
    ).toBeNull();
  });

  it("finds the profiles with an e-mail address whatever its case, for support", async () => {
    const byEmail = (email: string) =>
      asGateway((db) => new KyselyProfileRepository(db).findByEmail(email));
    expect(
      (await byEmail(" Alice.Martin@Example.COM ")).map((p) => p.id),
    ).toEqual(["u1"]);
    expect(await byEmail("nobody@example.com")).toEqual([]);
    // The column is not unique: an old profile can keep the address of a new account.
    await sql`insert into public.users (id, email) values ('u4', 'ALICE.MARTIN@example.com')`.execute(
      t.db,
    );
    expect(
      (await byEmail("alice.martin@example.com")).map((p) => p.id).sort(),
    ).toEqual(["u1", "u4"]);
  });
});

describe("trust links", () => {
  it("adds a link once, and removes only the caller's own", async () => {
    await asGateway(async (db) => {
      const trust = new KyselyTrustRepository(db);
      expect(await trust.add("u1", "u2")).toMatchObject({
        owner_id: "u1",
        trusted_id: "u2",
      });
      expect(await trust.add("u1", "u2")).toBeNull();
      await trust.add("u2", "u1");

      expect(await trust.remove("u3", "u2")).toBe(false);
      expect(await trust.remove("u1", "u2")).toBe(true);
      expect(await trust.trustedIds("u1")).toEqual([]);
      expect(await trust.trustedIds("u2")).toEqual(["u1"]);
    });
  });

  it("lists who the user trusts and who trusts them", async () => {
    await asGateway(async (db) => {
      const trust = new KyselyTrustRepository(db);
      await trust.add("u1", "u2");
      await trust.add("u3", "u2");

      expect((await trust.trustedProfiles("u1")).map((p) => p.id)).toEqual([
        "u2",
      ]);
      expect(
        (await trust.trusterProfiles("u2")).map((p) => p.id).sort(),
      ).toEqual(["u1", "u3"]);
      expect(await trust.trusters("u2", ["u1", "u2"])).toEqual(["u1"]);
      expect(await trust.trustedIds("u1", [])).toEqual([]);
    });
  });
});

describe("unit of work", () => {
  const event = { type: "trust.added", version: 1, payload: { ownerId: "u1" } };
  const outboxTypes = async () =>
    (
      await sql<{ type: string }>`select type from core.outbox`.execute(t.db)
    ).rows.map((r) => r.type);

  it("commits the writes and their events together", async () => {
    await asGateway((db) =>
      new KyselyUsersUnitOfWork(db).run(async ({ trust, events }) => {
        await trust.add("u1", "u2");
        await events.publish(event);
      }),
    );
    expect(await outboxTypes()).toEqual(["trust.added"]);
  });

  it("keeps neither the writes nor the events of a failed transaction", async () => {
    await expect(
      asGateway((db) =>
        new KyselyUsersUnitOfWork(db).run(async ({ trust, events }) => {
          await trust.add("u1", "u2");
          await events.publish(event);
          throw new Error("later step failed");
        }),
      ),
    ).rejects.toThrow("later step failed");

    expect(await outboxTypes()).toEqual([]);
    const { rows } = await sql`select 1 from public.trusted`.execute(t.db);
    expect(rows).toEqual([]);
  });

  it("deletes a profile with its trust links", async () => {
    await asGateway(async (db) => {
      await new KyselyTrustRepository(db).add("u1", "u2");
      await new KyselyTrustRepository(db).add("u2", "u1");
      expect(await new KyselyProfileRepository(db).delete("u1")).toBe(true);
      expect(await new KyselyProfileRepository(db).delete("u1")).toBe(false);
    });
    const { rows } = await sql`select 1 from public.trusted`.execute(t.db);
    expect(rows).toEqual([]);
  });
});
