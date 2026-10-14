import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compareSnapshots,
  readSnapshotFile,
  startTestDatabase,
  takeSnapshot,
} from "./index.js";

// `npm run check:schema`: the migrations replayed from scratch must give the hosted schema, as
// captured in supabase/introspection.json (or the file in SCHEMA_SNAPSHOT). Skipped by `npm test`,
// because a migration is committed before the user applies it.
const snapshotPath =
  process.env.SCHEMA_SNAPSHOT ??
  fileURLToPath(
    new URL("../../../supabase/introspection.json", import.meta.url),
  );

describe.runIf(process.env.CHECK_SCHEMA)("hosted schema", () => {
  it("matches the migrations replayed from scratch", async () => {
    const hosted = readSnapshotFile(snapshotPath);
    const t = await startTestDatabase();
    try {
      const drift = compareSnapshots(hosted, await takeSnapshot(t.db));
      const report = [
        ["In the hosted database only (missing migration?)", drift.onlyHosted],
        ["In the migrations only (not applied yet?)", drift.onlyInRepo],
        ["Different", drift.different],
        [
          "Not in the snapshot (rerun supabase/introspect.sql)",
          drift.notCompared,
        ],
      ]
        .filter(([, items]) => items.length > 0)
        .map(
          ([title, items]) =>
            `${title}:\n  ${(items as string[]).join("\n  ")}`,
        )
        .join("\n\n");
      if (report) console.log(`\n${report}\n`);
      expect(drift.onlyHosted).toEqual([]);
      expect(drift.onlyInRepo).toEqual([]);
      expect(drift.different).toEqual([]);
    } finally {
      await t.close();
    }
  }, 120_000);
});
