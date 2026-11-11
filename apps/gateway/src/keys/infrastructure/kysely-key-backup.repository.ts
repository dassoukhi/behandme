import { Inject, Injectable } from "@nestjs/common";
import type { Kysely } from "kysely";
import { DATABASE } from "@lib/platform";
import type { KeyBackupRepository } from "../application/ports.js";
import type { KeyBackup } from "../domain/backup.js";

export interface KeyBackupsTable {
  user_id: string;
  key_version: number;
  credential_id: string;
  synced: boolean;
  made_at: Date;
  box: Uint8Array;
  signature: Uint8Array;
}
type Db = Kysely<{ key_backups: KeyBackupsTable }>;

/** core.key_backups (supabase/migrations/20261111120000_key_backups.sql). */
@Injectable()
export class KyselyKeyBackupRepository implements KeyBackupRepository {
  private readonly db: Db;

  constructor(@Inject(DATABASE) db: Kysely<any>) {
    this.db = (db as Db).withSchema("core");
  }

  async find(userId: string): Promise<KeyBackup | null> {
    const row = await this.db
      .selectFrom("key_backups")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      userId: row.user_id,
      keyVersion: row.key_version,
      credentialId: row.credential_id,
      synced: row.synced,
      madeAt: row.made_at,
      box: new Uint8Array(row.box),
      signature: new Uint8Array(row.signature),
    };
  }

  async put(backup: KeyBackup): Promise<boolean> {
    // One row per user: of two backups, the one made last stays, whatever the order they arrive in. The same one
    // sent twice (a retry) changes nothing.
    const row = await this.db
      .insertInto("key_backups")
      .values({
        user_id: backup.userId,
        key_version: backup.keyVersion,
        credential_id: backup.credentialId,
        synced: backup.synced,
        made_at: backup.madeAt,
        box: backup.box,
        signature: backup.signature,
      })
      .onConflict((oc) =>
        oc
          .column("user_id")
          .doUpdateSet((eb) => ({
            key_version: eb.ref("excluded.key_version"),
            credential_id: eb.ref("excluded.credential_id"),
            synced: eb.ref("excluded.synced"),
            made_at: eb.ref("excluded.made_at"),
            box: eb.ref("excluded.box"),
            signature: eb.ref("excluded.signature"),
          }))
          .whereRef("key_backups.made_at", "<=", "excluded.made_at"),
      )
      .returning("user_id")
      .executeTakeFirst();
    return row !== undefined;
  }

  async deleteForUser(userId: string): Promise<boolean> {
    const rows = await this.db
      .deleteFrom("key_backups")
      .where("user_id", "=", userId)
      .returning("user_id")
      .execute();
    return rows.length > 0;
  }
}
