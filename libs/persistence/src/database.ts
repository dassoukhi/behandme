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
  /** A connection the server closed (pooler restart, network): reported, then replaced. */
  onConnectionError?: (error: Error) => void;
}

/**
 * The pooler may close a connection at any time (restart, network cut, laptop asleep). pg then emits
 * "error" on the pool for an idle connection, and on the client itself for one in use; an "error" event
 * nobody listens to ends the process, every service at once. Heard here: the pool drops the broken
 * connection, the query that was running fails (and is retried by whoever ran it), the next one opens a
 * new connection.
 */
function keepPoolAlive(pool: pg.Pool, onError: (error: Error) => void): void {
  pool.on("error", onError);
  pool.on("connect", (client) => client.on("error", onError));
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
  keepPoolAlive(
    pool,
    options.onConnectionError ??
      ((error) =>
        console.warn(
          `Database connection lost (${options.applicationName}): ${error.message}`,
        )),
  );
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
