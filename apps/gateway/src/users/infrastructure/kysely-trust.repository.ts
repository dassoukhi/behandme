import type { Kysely } from "kysely";
import type { Profile } from "../domain/profile.js";
import type { TrustLink } from "../domain/trust.js";
import type { TrustRepository } from "../application/ports.js";
import { toProfile } from "./kysely-profile.repository.js";
import type { UsersDatabase } from "./tables.js";

/** Trust links in public.trusted, on the gateway's connection or one of its transactions. */
export class KyselyTrustRepository implements TrustRepository {
  constructor(private readonly db: Kysely<UsersDatabase>) {}

  async add(ownerId: string, trustedId: string): Promise<TrustLink | null> {
    const row = await this.db
      .insertInto("trusted")
      .values({ owner_id: ownerId, trusted_id: trustedId })
      .onConflict((oc) => oc.columns(["owner_id", "trusted_id"]).doNothing())
      .returningAll()
      .executeTakeFirst();
    return row
      ? { ...row, created_at: row.created_at?.toISOString() ?? null }
      : null;
  }

  async remove(ownerId: string, trustedId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("trusted")
      .where("owner_id", "=", ownerId)
      .where("trusted_id", "=", trustedId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async trustedProfiles(ownerId: string): Promise<Profile[]> {
    const rows = await this.db
      .selectFrom("trusted")
      .innerJoin("users", "users.id", "trusted.trusted_id")
      .selectAll("users")
      .where("trusted.owner_id", "=", ownerId)
      .orderBy("trusted.created_at", "desc")
      .execute();
    return rows.map(toProfile);
  }

  async trusterProfiles(trustedId: string): Promise<Profile[]> {
    const rows = await this.db
      .selectFrom("trusted")
      .innerJoin("users", "users.id", "trusted.owner_id")
      .selectAll("users")
      .where("trusted.trusted_id", "=", trustedId)
      .orderBy("trusted.created_at", "desc")
      .execute();
    return rows.map(toProfile);
  }

  async trustedIds(ownerId: string, among?: string[]): Promise<string[]> {
    if (among?.length === 0) return [];
    let query = this.db
      .selectFrom("trusted")
      .select("trusted_id")
      .where("owner_id", "=", ownerId);
    if (among) {
      query = query.where("trusted_id", "in", among);
    }
    return (await query.execute()).map((row) => row.trusted_id);
  }

  async trusters(trustedId: string, ownerIds: string[]): Promise<string[]> {
    if (ownerIds.length === 0) return [];
    const rows = await this.db
      .selectFrom("trusted")
      .select("owner_id")
      .where("trusted_id", "=", trustedId)
      .where("owner_id", "in", ownerIds)
      .execute();
    return rows.map((row) => row.owner_id);
  }
}
