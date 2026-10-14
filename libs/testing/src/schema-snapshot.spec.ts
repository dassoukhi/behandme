import { describe, expect, it } from "vitest";
import { compareSnapshots, parseSnapshot } from "./schema-snapshot.js";

const column = (name: string, is_nullable = "NO") => ({
  table_schema: "public",
  table_name: "users",
  column_name: name,
  udt_name: "text",
  is_nullable,
  column_default: null,
  character_maximum_length: null,
  is_identity: "NO",
});

describe("schema snapshots", () => {
  it("reads the editor export, the bare object and a JSON string", () => {
    const snapshot = { columns: [column("id")] };
    expect(parseSnapshot([{ schema_snapshot: snapshot }])).toEqual(snapshot);
    expect(
      parseSnapshot({ schema_snapshot: JSON.stringify(snapshot) }),
    ).toEqual(snapshot);
    expect(parseSnapshot(snapshot)).toEqual(snapshot);
    expect(() => parseSnapshot([{ something: 1 }])).toThrow(
      "Not an introspect.sql snapshot",
    );
  });

  it("names what only one side has and what differs", () => {
    const hosted = {
      columns: [column("id"), column("email"), column("legacy")],
      rls: [
        {
          schema: "public",
          table_name: "users",
          rls_enabled: true,
          rls_forced: false,
        },
      ],
    };
    const repo = {
      columns: [column("id"), column("email", "YES"), column("phone")],
      rls: [
        {
          schema: "public",
          table_name: "users",
          rls_enabled: true,
          rls_forced: false,
        },
      ],
    };

    const drift = compareSnapshots(hosted, repo);

    expect(drift.onlyHosted).toEqual(["columns public.users.legacy"]);
    expect(drift.onlyInRepo).toEqual(["columns public.users.phone"]);
    expect(drift.different).toHaveLength(1);
    expect(drift.different[0]).toMatch(/^columns public\.users\.email\n/);
    expect(drift.notCompared).toContain("routine_grants");
    expect(drift.notCompared).not.toContain("rls");
  });

  it("ignores NOT NULL constraints, which only Postgres 18 lists", () => {
    const pkey = {
      schema: "public",
      table_name: "users",
      conname: "users_pkey",
      contype: "p",
      definition: "PRIMARY KEY (id)",
    };
    const notNull = {
      schema: "public",
      table_name: "users",
      conname: "users_id_not_null",
      contype: "n",
      definition: "NOT NULL id",
    };

    const drift = compareSnapshots(
      { constraints: [pkey] },
      { constraints: [pkey, notNull] },
    );

    expect(drift.onlyInRepo).toEqual([]);
  });

  it("names constraints of other schemas once", () => {
    const outbox = {
      schema: "core",
      table_name: "core.outbox",
      conname: "outbox_pkey",
      contype: "p",
      definition: "PRIMARY KEY (id)",
    };
    expect(
      compareSnapshots({ constraints: [] }, { constraints: [outbox] })
        .onlyInRepo,
    ).toEqual(["constraints core.outbox.outbox_pkey"]);
  });
});
