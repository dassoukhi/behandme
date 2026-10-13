import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

export interface DatabaseOptions {
  /** postgres:// URL, e.g. the Supabase pooler with the service's own role. Never logged. */
  connectionString: string;
  /** Shown in pg_stat_activity, to tell the services apart. */
  applicationName: string;
  maxConnections?: number;
  /** The pooler handshake can be slow from some networks. */
  connectionTimeoutMillis?: number;
  ssl?: pg.PoolConfig["ssl"];
}

/**
 * Typed query builder over a pg connection pool. Call `destroy()` on shutdown to close the pool.
 * Types follow the pg driver: bigint and numeric come back as strings, timestamptz as Date,
 * json/jsonb as parsed values.
 */
export function createDatabase<DB>(options: DatabaseOptions): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 30_000,
    ssl: options.ssl,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
