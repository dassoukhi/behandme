import type { Generated, Kysely, Selectable } from "kysely";
import type { InvitationRepository } from "../application/ports.js";
import type { Invitation } from "../domain/invitation.js";

interface InvitationsTable {
  id: Generated<string>;
  inviter_id: string;
  token_hash: Uint8Array;
  created_at: Generated<Date>;
  expires_at: Date;
  accepted_by: string | null;
  accepted_at: Date | null;
  cancelled_at: Date | null;
}
type Db = Kysely<{ invitations: InvitationsTable }>;

/** core.invitations (supabase/migrations/20261115120000_invitations.sql), on a connection or a transaction. */
export class KyselyInvitationRepository implements InvitationRepository {
  private readonly db: Db;

  constructor(db: Kysely<any>) {
    this.db = (db as Db).withSchema("core");
  }

  async create(invitation: {
    inviterId: string;
    tokenHash: Uint8Array;
    expiresAt: Date;
  }): Promise<Invitation> {
    const row = await this.db
      .insertInto("invitations")
      .values({
        inviter_id: invitation.inviterId,
        token_hash: invitation.tokenHash,
        expires_at: invitation.expiresAt,
        accepted_by: null,
        accepted_at: null,
        cancelled_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toInvitation(row);
  }

  async findByToken(tokenHash: Uint8Array): Promise<Invitation | null> {
    const row = await this.byToken(tokenHash).executeTakeFirst();
    return row ? toInvitation(row) : null;
  }

  async findByTokenForUpdate(
    tokenHash: Uint8Array,
  ): Promise<Invitation | null> {
    const row = await this.byToken(tokenHash).forUpdate().executeTakeFirst();
    return row ? toInvitation(row) : null;
  }

  async pending(inviterId: string, now: Date): Promise<Invitation[]> {
    const rows = await this.db
      .selectFrom("invitations")
      .selectAll()
      .where("inviter_id", "=", inviterId)
      .where("accepted_at", "is", null)
      .where("cancelled_at", "is", null)
      .where("expires_at", ">", now)
      .orderBy("created_at", "desc")
      .execute();
    return rows.map(toInvitation);
  }

  async countPending(inviterId: string, now: Date): Promise<number> {
    const row = await this.db
      .selectFrom("invitations")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("inviter_id", "=", inviterId)
      .where("accepted_at", "is", null)
      .where("cancelled_at", "is", null)
      .where("expires_at", ">", now)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async cancel(inviterId: string, id: string, now: Date): Promise<boolean> {
    const result = await this.db
      .updateTable("invitations")
      .set({ cancelled_at: now })
      .where("id", "=", id)
      .where("inviter_id", "=", inviterId)
      .where("accepted_at", "is", null)
      .where("cancelled_at", "is", null)
      .where("expires_at", ">", now)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async accept(id: string, inviteeId: string, now: Date): Promise<boolean> {
    const result = await this.db
      .updateTable("invitations")
      .set({ accepted_by: inviteeId, accepted_at: now })
      .where("id", "=", id)
      .where("accepted_at", "is", null)
      .where("cancelled_at", "is", null)
      .where("expires_at", ">", now)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async deleteExpiredBefore(before: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("invitations")
      .where("expires_at", "<", before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  private byToken(tokenHash: Uint8Array) {
    return this.db
      .selectFrom("invitations")
      .selectAll()
      .where("token_hash", "=", tokenHash);
  }
}

function toInvitation(row: Selectable<InvitationsTable>): Invitation {
  return {
    id: row.id,
    inviterId: row.inviter_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedBy: row.accepted_by,
    acceptedAt: row.accepted_at,
    cancelledAt: row.cancelled_at,
  };
}
