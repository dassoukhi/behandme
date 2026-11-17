import { type Kysely, type Selectable, sql } from "kysely";
import type { Profile } from "../domain/profile.js";
import type { ProfileFields, ProfileRepository } from "../application/ports.js";
import type { UsersDatabase, UsersTable } from "./tables.js";

/** Profiles in public.users, on the gateway's connection or one of its transactions. */
export class KyselyProfileRepository implements ProfileRepository {
  constructor(private readonly db: Kysely<UsersDatabase>) {}

  async find(id: string): Promise<Profile | null> {
    const row = await this.db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? toProfile(row) : null;
  }

  async findByEmail(email: string): Promise<Profile[]> {
    const rows = await this.db
      .selectFrom("users")
      .selectAll()
      .where(sql`lower(email)`, "=", email.trim().toLowerCase())
      .execute();
    return rows.map(toProfile);
  }

  async findMany(ids: string[]): Promise<Profile[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .selectFrom("users")
      .selectAll()
      .where("id", "in", ids)
      .execute();
    return rows.map(toProfile);
  }

  async create(
    id: string,
    fields: ProfileFields & { email: string },
  ): Promise<Profile> {
    const row = await this.db
      .insertInto("users")
      .values({ id, ...fields })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toProfile(row);
  }

  async update(id: string, fields: ProfileFields): Promise<Profile | null> {
    const row = await this.db
      .updateTable("users")
      .set({ ...fields, updated_at: sql<string>`now()` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row ? toProfile(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("users")
      .where("id", "=", id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async lock(id: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    return row !== undefined;
  }
}

export function toProfile(row: Selectable<UsersTable>): Profile {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
