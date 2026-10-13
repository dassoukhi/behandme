import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "@lib/persistence";

const SQL_DIR = fileURLToPath(new URL("../sql/", import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);

/**
 * Migrations up to this one alter tables that were created before the schema was tracked in the
 * repo. They join the test database once the baseline migration (from supabase/introspect.sql) exists.
 */
const LAST_PRE_BASELINE_MIGRATION = "20261013120000";

export interface TestDatabase {
  /** Connected as postgres (superuser, bypasses RLS), like the migrations. */
  db: Kysely<any>;
  /**
   * Runs `work` as `role`, with the rights that service has in production. Session-wide, so code
   * that opens its own transactions (relay, consumer) runs as that role too.
   */
  asRole<T>(role: string, work: (db: Kysely<any>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * In-process Postgres (PGlite) with the Supabase roles, pgmq and the repo's migrations, reached
 * through the real pg driver and `createDatabase`, as the services are in production.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const pglite = await PGlite.create();
  await pglite.exec(readFileSync(join(SQL_DIR, "supabase-roles.sql"), "utf8"));
  await pglite.exec(readFileSync(join(SQL_DIR, "pgmq-1.5.1.sql"), "utf8"));
  for (const file of trackedMigrations()) {
    await pglite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  const socketDir = mkdtempSync(join(tmpdir(), "pglite-"));
  const server = new PGLiteSocketServer({
    db: pglite,
    path: join(socketDir, ".s.PGSQL.5432"),
  });
  await server.start();
  // PGlite is a single session: one connection keeps transactions from interleaving.
  const db = createDatabase<any>({
    connectionString: `postgresql://postgres@localhost/postgres?host=${socketDir}`,
    applicationName: "test",
    maxConnections: 1,
  });

  return {
    db,
    async asRole(role, work) {
      await sql`set role ${sql.id(role)}`.execute(db);
      try {
        return await work(db);
      } finally {
        await sql`reset role`.execute(db);
      }
    },
    async close() {
      await db.destroy();
      await server.stop();
      await pglite.close();
      rmSync(socketDir, { recursive: true, force: true });
    },
  };
}

/** Migration files the test database applies, in order. */
export function trackedMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => file.slice(0, 14) > LAST_PRE_BASELINE_MIGRATION)
    .sort();
}
