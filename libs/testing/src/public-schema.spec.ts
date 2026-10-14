import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./test-database.js";

// The public schema after every migration, in particular 20261014120000_revoke_client_roles_in_public.

let t: TestDatabase;
beforeAll(async () => {
  t = await startTestDatabase();
}, 60_000);
afterAll(() => t?.close());

const CLIENT_ROLES = ["anon", "authenticated"];

async function rows<T>(query: string): Promise<T[]> {
  return (await sql.raw<T>(query).execute(t.db)).rows;
}

describe("client roles (anon and authenticated keys)", () => {
  it("hold no privilege on any public table, sequence or function", async () => {
    const tableGrants = await rows(`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`);
    const executable = await rows(`
      select p.oid::regprocedure::text as fn, r.role
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
           unnest(array['anon', 'authenticated']) r(role)
      where n.nspname = 'public' and has_function_privilege(r.role, p.oid, 'EXECUTE')`);
    const sequences = await rows(`
      select c.relname, r.role
      from pg_class c join pg_namespace n on n.oid = c.relnamespace,
           unnest(array['anon', 'authenticated']) r(role)
      where n.nspname = 'public' and c.relkind = 'S'
        and has_sequence_privilege(r.role, c.oid, 'USAGE')`);

    expect(tableGrants).toEqual([]);
    expect(executable).toEqual([]);
    expect(sequences).toEqual([]);
  });

  it.each(CLIENT_ROLES)(
    "%s can neither read nor truncate a table",
    async (role) => {
      await expect(
        t.asRole(role, (db) => sql`select * from public.users`.execute(db)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        t.asRole(role, (db) => sql`truncate public.trusted`.execute(db)),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("get nothing on tables and functions created later in public", async () => {
    await sql`
      create table public.later (id int generated always as identity);
      create function public.later_fn() returns int language sql as 'select 1';`.execute(
      t.db,
    );

    for (const role of CLIENT_ROLES) {
      const [rights] = await rows<Record<string, boolean>>(`
        select has_table_privilege('${role}', 'public.later', 'SELECT') as can_select,
               has_sequence_privilege('${role}', pg_get_serial_sequence('public.later', 'id'), 'USAGE')
                 as can_use_sequence,
               has_function_privilege('${role}', 'public.later_fn()', 'EXECUTE') as can_execute`);
      expect({ role, ...rights }).toEqual({
        role,
        can_select: false,
        can_use_sequence: false,
        can_execute: false,
      });
    }
    const [{ api }] = await rows<{ api: boolean }>(
      "select has_table_privilege('service_role', 'public.later', 'SELECT,INSERT,UPDATE,DELETE') as api",
    );
    expect(api).toBe(true);
  });
});

describe("the API role (service_role)", () => {
  it("still reads the tables and runs get_trusted_users", async () => {
    await sql`
      insert into public.users (id, email) values ('user_a', 'a@example.com'), ('user_b', 'b@example.com');
      insert into public.trusted (owner_id, trusted_id) values ('user_a', 'user_b');`.execute(
      t.db,
    );

    const trusted = await t.asRole("service_role", (db) =>
      sql<{
        id: string;
      }>`select id from public.get_trusted_users('user_a')`.execute(db),
    );

    expect(trusted.rows).toEqual([{ id: "user_b" }]);
    await sql`delete from public.users`.execute(t.db);
  });
});

describe("leftovers", () => {
  it("drops get_contract_with_validators, broken since the blockchain columns went", async () => {
    expect(
      await rows(
        "select 1 from pg_proc where proname = 'get_contract_with_validators'",
      ),
    ).toEqual([]);
  });

  it("keeps one cascading foreign key from trusted.trusted_id to users", async () => {
    const keys = await rows<{ conname: string; on_delete: string }>(`
      select conname, confdeltype as on_delete from pg_constraint
      where conrelid = 'public.trusted'::regclass and contype = 'f'
        and conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.trusted'::regclass and attname = 'trusted_id')]`);
    expect(keys).toEqual([
      { conname: "trusted_trusted_id_fkey", on_delete: "c" },
    ]);

    await sql`
      insert into public.users (id, email) values ('user_a', 'a@example.com'), ('user_b', 'b@example.com');
      insert into public.trusted (owner_id, trusted_id) values ('user_a', 'user_b');
      delete from public.users where id = 'user_b';`.execute(t.db);
    expect(await rows("select * from public.trusted")).toEqual([]);
    await sql`delete from public.users`.execute(t.db);
  });
});
