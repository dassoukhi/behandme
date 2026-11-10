import { Inject, Injectable } from "@nestjs/common";
import type { Generated, Kysely, Selectable } from "kysely";
import { DATABASE } from "@lib/platform";
import type { KeyTransferRepository } from "../application/ports.js";
import type { KeyTransfer } from "../domain/transfer.js";

interface KeyTransfersTable {
  id: Generated<string>;
  user_id: string;
  recipient_key: Uint8Array;
  key_version: number;
  wrap: Uint8Array | null;
  created_at: Generated<Date>;
  expires_at: Date;
}
type Db = Kysely<{ key_transfers: KeyTransfersTable }>;

/** core.key_transfers (supabase/migrations/20261110120000_key_transfers.sql). */
@Injectable()
export class KyselyKeyTransferRepository implements KeyTransferRepository {
  private readonly db: Db;

  constructor(@Inject(DATABASE) db: Kysely<any>) {
    this.db = (db as Db).withSchema("core");
  }

  async open(
    transfer: Omit<KeyTransfer, "id" | "wrap" | "createdAt">,
  ): Promise<KeyTransfer> {
    // One row per user (unique user_id): two phones opening at once leave one transfer, the last one.
    const row = await this.db
      .insertInto("key_transfers")
      .values({
        user_id: transfer.userId,
        recipient_key: transfer.recipientKey,
        key_version: transfer.keyVersion,
        expires_at: transfer.expiresAt,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet((eb) => ({
          id: eb.ref("excluded.id"),
          recipient_key: eb.ref("excluded.recipient_key"),
          key_version: eb.ref("excluded.key_version"),
          wrap: null,
          created_at: eb.ref("excluded.created_at"),
          expires_at: eb.ref("excluded.expires_at"),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toTransfer(row);
  }

  async find(id: string, userId: string): Promise<KeyTransfer | null> {
    const row = await this.select(id, userId).executeTakeFirst();
    return row ? toTransfer(row) : null;
  }

  async findForUpdate(id: string, userId: string): Promise<KeyTransfer | null> {
    const row = await this.select(id, userId).forUpdate().executeTakeFirst();
    return row ? toTransfer(row) : null;
  }

  async deposit(id: string, wrap: Uint8Array): Promise<void> {
    await this.db
      .updateTable("key_transfers")
      .set({ wrap })
      .where("id", "=", id)
      .execute();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("key_transfers").where("id", "=", id).execute();
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.db
      .deleteFrom("key_transfers")
      .where("user_id", "=", userId)
      .execute();
  }

  async deleteExpired(now: Date): Promise<number> {
    const rows = await this.db
      .deleteFrom("key_transfers")
      .where("expires_at", "<=", now)
      .returning("id")
      .execute();
    return rows.length;
  }

  private select(id: string, userId: string) {
    return this.db
      .selectFrom("key_transfers")
      .selectAll()
      .where("id", "=", id)
      .where("user_id", "=", userId);
  }
}

function toTransfer(row: Selectable<KeyTransfersTable>): KeyTransfer {
  return {
    id: row.id,
    userId: row.user_id,
    recipientKey: new Uint8Array(row.recipient_key),
    keyVersion: row.key_version,
    wrap: row.wrap ? new Uint8Array(row.wrap) : null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
