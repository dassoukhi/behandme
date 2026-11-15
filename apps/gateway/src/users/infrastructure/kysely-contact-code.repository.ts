import type { Kysely } from "kysely";
import type { ContactCodeRepository } from "../application/ports.js";
import type { ContactCode } from "../domain/contact-code.js";

interface ContactCodesTable {
  user_id: string;
  token_hash: Uint8Array;
  expires_at: Date;
}
type Db = Kysely<{ contact_codes: ContactCodesTable }>;

/** core.contact_codes (supabase/migrations/20261115120000_invitations.sql), on a connection or a transaction. */
export class KyselyContactCodeRepository implements ContactCodeRepository {
  private readonly db: Db;

  constructor(db: Kysely<any>) {
    this.db = (db as Db).withSchema("core");
  }

  async replace(code: ContactCode & { tokenHash: Uint8Array }): Promise<void> {
    await this.db
      .insertInto("contact_codes")
      .values({
        user_id: code.userId,
        token_hash: code.tokenHash,
        expires_at: code.expiresAt,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet((eb) => ({
          token_hash: eb.ref("excluded.token_hash"),
          expires_at: eb.ref("excluded.expires_at"),
        })),
      )
      .execute();
  }

  async findByToken(tokenHash: Uint8Array): Promise<ContactCode | null> {
    const row = await this.db
      .selectFrom("contact_codes")
      .select(["user_id", "expires_at"])
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();
    return row ? { userId: row.user_id, expiresAt: row.expires_at } : null;
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("contact_codes")
      .where("expires_at", "<=", now)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
