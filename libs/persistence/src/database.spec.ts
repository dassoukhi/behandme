import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { createDatabase } from "./database.js";

describe("a connection the server closes", () => {
  it("is reported and replaced, instead of ending the process", async () => {
    const pglite = await PGlite.create();
    const dir = mkdtempSync(join(tmpdir(), "pglite-"));
    const serve = async () => {
      const server = new PGLiteSocketServer({
        db: pglite,
        path: join(dir, ".s.PGSQL.5432"),
      });
      await server.start();
      return server;
    };
    let server = await serve();
    const lost: string[] = [];
    const db = createDatabase<any>({
      connectionString: `postgresql://postgres@localhost/postgres?host=${dir}`,
      applicationName: "test",
      maxConnections: 1,
      onConnectionError: (error) => lost.push(error.message),
    });
    try {
      // The server goes away while a connection is in use, as when the pooler restarts. Unheard, the
      // client's "error" event would end this process.
      await db.connection().execute(async (connection) => {
        await sql`select 1`.execute(connection);
        await server.stop();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(lost).not.toHaveLength(0);

      server = await serve();
      const { rows } = await sql<{ ok: number }>`select 1 as ok`.execute(db);
      expect(rows[0].ok).toBe(1);
    } finally {
      await db.destroy();
      await server.stop();
      await pglite.close();
    }
  });
});
