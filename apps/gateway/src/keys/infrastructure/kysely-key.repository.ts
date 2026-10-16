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
interface UserKeyHistoryTable {
  user_id: string;
  key_version: number;
  kem_public_key: Uint8Array;
  signing_public_key: Uint8Array;
  fingerprint: string;
  signature: Uint8Array;
  created_at: Date;
  reason: "reset";
}
type Db = Kysely<{
  user_keys: UserKeysTable;
  user_key_history: UserKeyHistoryTable;
}>;

/**
 * core.user_keys and core.user_key_history (supabase/migrations/20261015090000_user_keys.sql). Bound to
 * a transaction by KyselyKeysUnitOfWork for `replace`.
 */
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

  async findVersion(
    userId: string,
    keyVersion: number,
  ): Promise<RegisteredKeys | null> {
    const current = await this.find(userId);
    if (current?.keyVersion === keyVersion) return current;
    const row = await this.db
      .selectFrom("user_key_history")
      .selectAll()
      .where("user_id", "=", userId)
      .where("key_version", "=", keyVersion)
      .executeTakeFirst();
    if (!row) return null;
    return {
      userId: row.user_id,
      keyVersion: row.key_version,
      kemPublicKey: new Uint8Array(row.kem_public_key),
      signingPublicKey: new Uint8Array(row.signing_public_key),
      fingerprint: row.fingerprint,
      signature: new Uint8Array(row.signature),
      usableFrom: row.created_at,
      createdAt: row.created_at,
    };
  }

  async replace(
    replacedVersion: number,
    keys: RegisteredKeys,
    reason: "reset",
  ): Promise<boolean> {
    // Locked until the transaction ends: of two resets at once, the second finds the new version.
    const old = await this.db
      .selectFrom("user_keys")
      .selectAll()
      .where("user_id", "=", keys.userId)
      .where("key_version", "=", replacedVersion)
      .forUpdate()
      .executeTakeFirst();
    if (!old) return false;
    await this.db
      .insertInto("user_key_history")
      .values({
        user_id: old.user_id,
        key_version: old.key_version,
        kem_public_key: old.kem_public_key,
        signing_public_key: old.signing_public_key,
        fingerprint: old.fingerprint,
        signature: old.signature,
        created_at: old.created_at,
        reason,
      })
      .execute();
    await this.db
      .updateTable("user_keys")
      .set({
        key_version: keys.keyVersion,
        kem_public_key: keys.kemPublicKey,
        signing_public_key: keys.signingPublicKey,
        fingerprint: keys.fingerprint,
        signature: keys.signature,
        usable_from: keys.usableFrom,
        created_at: keys.createdAt,
      })
      .where("user_id", "=", keys.userId)
      .execute();
    return true;
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
