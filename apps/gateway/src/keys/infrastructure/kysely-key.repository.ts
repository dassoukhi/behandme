import { Inject, Injectable } from "@nestjs/common";
import { type Generated, type Kysely, type Selectable, sql } from "kysely";
import { DATABASE } from "@lib/platform";
import type { KeyCare, PhraseLocation } from "../domain/care.js";
import type { RegisteredKeys } from "../domain/keys.js";
import type { KeyRepository } from "../application/ports.js";
import type { KeyBackupsTable } from "./kysely-key-backup.repository.js";

interface UserKeysTable {
  user_id: string;
  key_version: number;
  kem_public_key: Uint8Array;
  signing_public_key: Uint8Array;
  fingerprint: string;
  signature: Uint8Array;
  usable_from: Date;
  created_at: Date;
  proven_on: Date | null;
  phrase_checked_at: Date | null;
  phrase_checks: Generated<number>;
  phrase_location: PhraseLocation | null;
  care_reminded_at: Date | null;
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
  key_backups: KeyBackupsTable;
}>;

/**
 * core.user_keys and core.user_key_history (supabase/migrations/20261015090000_user_keys.sql), with the
 * passkey backup of the current keys in their care (core.key_backups). Bound to a transaction by
 * KyselyKeysUnitOfWork for `replace`.
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

  async findForShare(userId: string): Promise<RegisteredKeys | null> {
    // A reset locks the row for update (`replace`): it waits for this transaction, or this one for it.
    const row = await this.db
      .selectFrom("user_keys")
      .selectAll()
      .where("user_id", "=", userId)
      .forShare()
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
        // What we knew of the old keys and their phrase says nothing of the new ones.
        proven_on: null,
        phrase_checked_at: null,
        phrase_checks: 0,
        phrase_location: null,
        care_reminded_at: null,
      })
      .where("user_id", "=", keys.userId)
      .execute();
    return true;
  }

  async careOf(userIds: string[]): Promise<KeyCare[]> {
    if (userIds.length === 0) return [];
    const rows = await careQuery(this.db)
      .where("user_keys.user_id", "in", userIds)
      .execute();
    return rows.map(toCare);
  }

  async carePage(
    afterUserId: string | null,
    limit: number,
  ): Promise<KeyCare[]> {
    let query = careQuery(this.db).orderBy("user_keys.user_id").limit(limit);
    if (afterUserId !== null) {
      query = query.where("user_keys.user_id", ">", afterUserId);
    }
    return (await query.execute()).map(toCare);
  }

  async recordProof(
    userId: string,
    keyVersion: number,
    day: Date,
  ): Promise<boolean> {
    const row = await this.db
      .updateTable("user_keys")
      .set({ proven_on: sql<Date>`greatest(proven_on, ${day}::timestamptz)` })
      .where("user_id", "=", userId)
      .where("key_version", "=", keyVersion)
      .returning("user_id")
      .executeTakeFirst();
    return row !== undefined;
  }

  async updateCare(
    userId: string,
    keyVersion: number,
    change: {
      checkedAt?: Date;
      countCheck?: boolean;
      location?: PhraseLocation;
    },
  ): Promise<boolean> {
    const row = await this.db
      .updateTable("user_keys")
      .set((eb) => ({
        ...(change.checkedAt ? { phrase_checked_at: change.checkedAt } : {}),
        ...(change.countCheck
          ? { phrase_checks: eb("phrase_checks", "+", 1) }
          : {}),
        ...(change.location ? { phrase_location: change.location } : {}),
      }))
      .where("user_id", "=", userId)
      .where("key_version", "=", keyVersion)
      .returning("user_id")
      .executeTakeFirst();
    return row !== undefined;
  }

  async markReminded(userIds: string[], at: Date): Promise<void> {
    if (userIds.length === 0) return;
    await this.db
      .updateTable("user_keys")
      .set({ care_reminded_at: at })
      .where("user_id", "in", userIds)
      .execute();
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

/** The care of the current keys, with their passkey backup: one made for other keys, before a reset, is not theirs. */
function careQuery(db: Db) {
  return db
    .selectFrom("user_keys")
    .leftJoin("key_backups", (join) =>
      join
        .onRef("key_backups.user_id", "=", "user_keys.user_id")
        .onRef("key_backups.key_version", "=", "user_keys.key_version"),
    )
    .select([
      "user_keys.user_id",
      "user_keys.key_version",
      "user_keys.fingerprint",
      "user_keys.created_at",
      "user_keys.proven_on",
      "user_keys.phrase_checked_at",
      "user_keys.phrase_checks",
      "user_keys.phrase_location",
      "user_keys.care_reminded_at",
      "key_backups.credential_id as backup_credential_id",
      "key_backups.synced as backup_synced",
      "key_backups.made_at as backup_made_at",
    ]);
}

type CareRow = Awaited<
  ReturnType<ReturnType<typeof careQuery>["execute"]>
>[number];

function toCare(row: CareRow): KeyCare {
  // The join gives the backup's columns all null, or none: checking each only narrows their types.
  const { backup_credential_id, backup_synced, backup_made_at } = row;
  return {
    userId: row.user_id,
    keyVersion: row.key_version,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    provenOn: row.proven_on,
    phraseCheckedAt: row.phrase_checked_at,
    phraseChecks: row.phrase_checks,
    phraseLocation: row.phrase_location,
    remindedAt: row.care_reminded_at,
    passkeyBackup:
      backup_credential_id !== null &&
      backup_synced !== null &&
      backup_made_at !== null
        ? {
            credentialId: backup_credential_id,
            synced: backup_synced,
            madeAt: backup_made_at,
          }
        : null,
  };
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
