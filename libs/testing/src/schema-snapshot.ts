import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";

/** Output of supabase/introspect.sql: one array of catalog rows per section. */
export type SchemaSnapshot = Record<string, Record<string, unknown>[] | null>;

export interface SchemaDrift {
  /** Objects the hosted database has and the migrations do not create. */
  onlyHosted: string[];
  /** Objects the migrations create that the hosted database lacks (often: not applied yet). */
  onlyInRepo: string[];
  /** Objects present on both sides with different definitions. */
  different: string[];
  /** Sections the hosted snapshot does not contain (taken with an older introspect.sql). */
  notCompared: string[];
}

const INTROSPECT_SQL = new URL(
  "../../../supabase/introspect.sql",
  import.meta.url,
);

/** Section → how to name an object and which of its fields must match. */
const SECTIONS: Record<
  string,
  { key: (row: any) => string; fields: string[]; skip?: (row: any) => boolean }
> = {
  columns: {
    key: (r) => `${r.table_schema}.${r.table_name}.${r.column_name}`,
    fields: [
      "udt_name",
      "is_nullable",
      "column_default",
      "character_maximum_length",
      "is_identity",
    ],
  },
  constraints: {
    // regclass text is schema-qualified outside public.
    key: (r) =>
      `${r.table_name.includes(".") ? r.table_name : `${r.schema}.${r.table_name}`}.${r.conname}`,
    fields: ["contype", "definition"],
    // Postgres 18 (PGlite) also lists NOT NULL as constraints; columns already compare nullability.
    skip: (r) => r.contype === "n",
  },
  indexes: {
    key: (r) => `${r.schemaname}.${r.indexname}`,
    fields: ["indexdef"],
  },
  enums: {
    key: (r) => `${r.schema ?? "public"}.${r.typname}`,
    fields: ["labels"],
  },
  functions: {
    key: (r) => `${r.schema ?? "public"}.${r.proname}(${r.args})`,
    fields: ["security_definer", "definition"],
  },
  triggers: {
    key: (r) =>
      `${r.schema ?? "public"}.${r.table_name}.${r.trigger_name}.${r.event_manipulation}`,
    fields: ["action_timing", "action_statement"],
  },
  rls: {
    key: (r) => `${r.schema ?? "public"}.${r.table_name}`,
    fields: ["rls_enabled", "rls_forced"],
  },
  policies: {
    key: (r) => `${r.schemaname ?? "public"}.${r.tablename}.${r.policyname}`,
    fields: ["roles", "cmd", "qual", "with_check"],
  },
  grants: {
    key: (r) => `${r.table_schema ?? "public"}.${r.table_name} to ${r.grantee}`,
    fields: ["privileges"],
  },
  routine_grants: {
    key: (r) => `${r.routine_schema}.${r.routine_name} to ${r.grantee}`,
    fields: ["privileges"],
  },
  // Extensions differ by platform (PGlite has few); they are not compared.
};

/** Reads a snapshot exported by the Supabase SQL editor, with or without its wrapping. */
export function parseSnapshot(json: unknown): SchemaSnapshot {
  let value = Array.isArray(json) ? json[0] : json;
  if (value && typeof value === "object" && "schema_snapshot" in value) {
    value = (value as { schema_snapshot: unknown }).schema_snapshot;
  }
  if (typeof value === "string") value = JSON.parse(value);
  if (!value || typeof value !== "object" || !("columns" in value)) {
    throw new Error("Not an introspect.sql snapshot");
  }
  return value as SchemaSnapshot;
}

export function readSnapshotFile(path: string): SchemaSnapshot {
  return parseSnapshot(JSON.parse(readFileSync(path, "utf8")));
}

/** Runs supabase/introspect.sql on `db`. */
export async function takeSnapshot(db: Kysely<any>): Promise<SchemaSnapshot> {
  const { rows } = await sql
    .raw<{ schema_snapshot: unknown }>(readFileSync(INTROSPECT_SQL, "utf8"))
    .execute(db);
  return parseSnapshot(rows[0]);
}

export function compareSnapshots(
  hosted: SchemaSnapshot,
  repo: SchemaSnapshot,
): SchemaDrift {
  const drift: SchemaDrift = {
    onlyHosted: [],
    onlyInRepo: [],
    different: [],
    notCompared: [],
  };
  for (const [section, { key, fields, skip }] of Object.entries(SECTIONS)) {
    if (!(section in hosted)) {
      drift.notCompared.push(section);
      continue;
    }
    const pick = (row: Record<string, unknown>) =>
      JSON.stringify(fields.map((field) => row[field] ?? null));
    const rows = (snapshot: SchemaSnapshot) =>
      new Map(
        (snapshot[section] ?? [])
          .filter((row) => !skip?.(row))
          .map((row) => [key(row), pick(row)]),
      );
    const hostedRows = rows(hosted);
    const repoRows = rows(repo);
    for (const [name, value] of hostedRows) {
      if (!repoRows.has(name)) drift.onlyHosted.push(`${section} ${name}`);
      else if (repoRows.get(name) !== value)
        drift.different.push(
          `${section} ${name}\n    hosted: ${value}\n    repo:   ${repoRows.get(name)}`,
        );
    }
    for (const name of repoRows.keys()) {
      if (!hostedRows.has(name)) drift.onlyInRepo.push(`${section} ${name}`);
    }
  }
  return drift;
}
