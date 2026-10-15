import { Inject, Injectable } from "@nestjs/common";
import type { Kysely, Selectable } from "kysely";
import { DATABASE } from "@lib/platform";
import type { RegisteredKeys } from "../domain/keys.js";
import type { KeyRepository } from "../application/ports.js";

interface UserKeysTable {
  user_id: string;
  key_version: number;
  kem_public_key: Uint8Array;
  signing_public_key: Uint8Array;
  fingerprint: string;
  signature: Uint8Array;
  usable_from: Date;
  created_at: Date;
}
type Db = Kysely<{ user_keys: UserKeysTable }>;

/** core.user_keys (supabase/migrations/20261015090000_user_keys.sql). */
@Injectable()
export class KyselyKeyRepository implements KeyRepository {
  private readonly db: Db;

  constructor(@Inject(DATABASE) db: Kysely<any>) {
    this.db = (db as Db).withSchema("core");
  }

  async find(userId: string): Promise<RegisteredKeys | null> {
    const row = await this.db
      .selectFrom("user_keys")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row ? toKeys(row) : null;
  }

  async findMany(userIds: string[]): Promise<RegisteredKeys[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .selectFrom("user_keys")
      .selectAll()
      .where("user_id", "in", userIds)
      .orderBy("user_id")
      .execute();
    return rows.map(toKeys);
  }

  async insert(keys: Omit<RegisteredKeys, "createdAt">): Promise<boolean> {
    const row = await this.db
      .insertInto("user_keys")
      .values({
        user_id: keys.userId,
        key_version: keys.keyVersion,
        kem_public_key: keys.kemPublicKey,
        signing_public_key: keys.signingPublicKey,
        fingerprint: keys.fingerprint,
        signature: keys.signature,
        usable_from: keys.usableFrom,
        created_at: keys.usableFrom,
      })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .returning("user_id")
      .executeTakeFirst();
    return row !== undefined;
  }
}

function toKeys(row: Selectable<UserKeysTable>): RegisteredKeys {
  return {
    userId: row.user_id,
    keyVersion: row.key_version,
    kemPublicKey: new Uint8Array(row.kem_public_key),
    signingPublicKey: new Uint8Array(row.signing_public_key),
    fingerprint: row.fingerprint,
    signature: new Uint8Array(row.signature),
    usableFrom: row.usable_from,
    createdAt: row.created_at,
  };
}
