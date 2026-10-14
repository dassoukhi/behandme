import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "@lib/testing";
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
    delete from public.trusted; delete from public.contracts; delete from public.users;
    delete from core.outbox;
    insert into public.users (id, email, first_name, last_name) values
      ('u1', 'alice.martin@example.com', 'Alice', 'Durand'),
      ('u2', 'bob@example.com', 'Bob', 'Durand'),
      ('u3', 'promo@example.com', '50%_off', 'Durand');
  `.execute(t.db);
});

const asGateway = <T>(work: (db: Kysely<any>) => Promise<T>) =>
  t.asRole("svc_gateway", work);

describe("profile search", () => {
  const ids = (term: string) =>
    asGateway(async (db) =>
      (await new KyselyProfileRepository(db).search(term, 20)).map((p) => p.id),
    );

  it("matches names partially, whatever the case", async () => {
    expect(await ids("ALI")).toEqual(["u1"]);
  });

  it("matches an email only when given in full, so addresses cannot be harvested", async () => {
    expect(await ids("alice.martin@")).toEqual([]);
    expect(await ids("@example.com")).toEqual([]);
    expect(await ids("Alice.Martin@Example.com")).toEqual(["u1"]);
  });

  it("treats % and _ in the query as plain characters", async () => {
    expect(await ids("%")).toEqual(["u3"]);
    expect(await ids("_")).toEqual(["u3"]);
    expect(await ids("b_b@example.com")).toEqual([]);
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
