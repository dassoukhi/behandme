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

  async search(term: string, limit: number): Promise<Profile[]> {
    // Bound parameters, LIKE wildcards escaped: the term is matched literally.
    const literal = escapeLike(term);
    const byColumn = (
      column: "first_name" | "last_name" | "email",
      pattern: string,
    ) =>
      this.db
        .selectFrom("users")
        .selectAll()
        .where(column, "ilike", pattern)
        .orderBy("id")
        .limit(limit)
        .execute();
    const results = await Promise.all([
      byColumn("first_name", `%${literal}%`),
      byColumn("last_name", `%${literal}%`),
      byColumn("email", literal),
    ]);
    return results.flat().map(toProfile);
  }
}

export function toProfile(row: Selectable<UsersTable>): Profile {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Escapes LIKE wildcards (backslash is Postgres's default escape character). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
