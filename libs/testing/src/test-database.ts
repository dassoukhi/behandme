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
 * In-process Postgres (PGlite) with the Supabase roles, pgmq and the repo's migrations (unless
 * `migrations: false`), reached through the real pg driver and `createDatabase`, as the services
 * are in production.
 */
export async function startTestDatabase({
  migrations = true,
}: { migrations?: boolean } = {}): Promise<TestDatabase> {
  const pglite = await PGlite.create();
  await pglite.exec(readFileSync(join(SQL_DIR, "supabase-roles.sql"), "utf8"));
  // Same pgmq version as the hosted project. Installed as an extension, it gets its schema from
  // the control file; the SQL-only install needs it created first.
  await pglite.exec("create schema pgmq;");
  await pglite.exec(readFileSync(join(SQL_DIR, "pgmq-1.4.4.sql"), "utf8"));
  // pgmq.create registers each queue table with the extension unless this says it already is;
  // there is no extension to register with here. Queue behaviour is unaffected.
  await pglite.exec(
    "create or replace function pgmq._belongs_to_pgmq(table_name text) returns boolean language sql as 'select true';",
  );
  for (const file of migrations ? trackedMigrations() : []) {
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

/** Migration files, in the order they apply (the baseline first). */
export function trackedMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}
