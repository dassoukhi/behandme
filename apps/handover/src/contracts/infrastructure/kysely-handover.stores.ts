import { Inject, Injectable } from "@nestjs/common";
import canonicalize from "canonicalize";
import { type Kysely, type Selectable, sql } from "kysely";
import { currentCorrelationId, newId, systemClock } from "@lib/kernel";
import { type Executor, TransactionalOutbox } from "@lib/messaging";
import { DATABASE } from "@lib/platform";
import type { Claim, ClaimStatus, Decision } from "../domain/claims.js";
import type { AuditEntry } from "../domain/audit-events.js";
import type { ChainEvent } from "../domain/audit-chain.js";
import type {
  Category,
  Contract,
  ContractChanges,
  DraftInput,
  Status,
} from "../domain/contract.js";
import type {
  AuditLog,
  ClaimRepository,
  ContractRepository,
  EventPublisher,
  HandoverStore,
  HandoverStores,
  Sealing,
  SealingRepository,
} from "../application/ports.js";
import type {
  ClaimsTable,
  ContractsTable,
  HandoverDatabase,
} from "./tables.js";

type Db = Kysely<HandoverDatabase>;

function handover(db: Executor): Db {
  return (db as unknown as Db).withSchema("handover");
}

class KyselyContracts implements ContractRepository {
  constructor(private readonly db: Db) {}

  async find(id: string): Promise<Contract | null> {
    const row = await this.db
      .selectFrom("contracts")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? (await this.withParticipants([row]))[0] : null;
  }

  async listFor(userId: string): Promise<Contract[]> {
    const rows = await this.db
      .selectFrom("contracts")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("owner_id", "=", userId),
          eb(
            "id",
            "in",
            eb
              .selectFrom("participants")
              .select("contract_id")
              .where("user_id", "=", userId),
          ),
        ]),
      )
      .orderBy("created_at", "desc")
      .orderBy("id")
      .execute();
    return this.withParticipants(rows);
  }

  async insert(ownerId: string, input: DraftInput): Promise<Contract> {
    const row = await this.db
      .insertInto("contracts")
      .values({
        owner_id: ownerId,
        category: input.category,
        description: input.description,
        contest_days: input.contestDays,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db
      .insertInto("participants")
      .values([
        {
          contract_id: row.id,
          user_id: input.accessorId,
          role: "accessor",
          position: 0,
        },
        ...input.validatorIds.map((userId, position) => ({
          contract_id: row.id,
          user_id: userId,
          role: "validator" as const,
          position,
        })),
      ])
      .execute();
    return toContract(row, input.accessorId, input.validatorIds);
  }

  async update(
    id: string,
    changes: ContractChanges,
    expectedVersion: number,
  ): Promise<Contract | null> {
    const { contestDays, ...fields } = changes;
    const row = await this.db
      .updateTable("contracts")
      .set({
        ...fields,
        ...(contestDays !== undefined ? { contest_days: contestDays } : {}),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", id)
      .where("version", "=", expectedVersion)
      .returningAll()
      .executeTakeFirst();
    return row ? (await this.withParticipants([row]))[0] : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("contracts").where("id", "=", id).execute();
  }

  async markSealed(
    id: string,
    sealing: {
      sealedVersion: number;
      accessorId: string;
      validatorIds: string[];
    },
    expectedVersion: number,
  ): Promise<Contract | null> {
    const row = await this.db
      .updateTable("contracts")
      .set({
        status: "active",
        sealed_version: sealing.sealedVersion,
        sealed_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", id)
      .where("version", "=", expectedVersion)
      .returningAll()
      .executeTakeFirst();
    if (!row) return null;
    await this.db
      .deleteFrom("participants")
      .where("contract_id", "=", id)
      .execute();
    await this.db
      .insertInto("participants")
      .values([
        {
          contract_id: id,
          user_id: sealing.accessorId,
          role: "accessor",
          position: 0,
        },
        ...sealing.validatorIds.map((userId, position) => ({
          contract_id: id,
          user_id: userId,
          role: "validator" as const,
          position,
        })),
      ])
      .execute();
    return toContract(row, sealing.accessorId, sealing.validatorIds);
  }

  async markRevoked(
    id: string,
    expectedVersion: number,
  ): Promise<Contract | null> {
    const row = await this.db
      .updateTable("contracts")
      .set({
        status: "revoked",
        revoked_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", id)
      .where("version", "=", expectedVersion)
      .returningAll()
      .executeTakeFirst();
    return row ? (await this.withParticipants([row]))[0] : null;
  }

  async transition(
    id: string,
    from: Status,
    to: Status,
  ): Promise<Contract | null> {
    const row = await this.db
      .updateTable("contracts")
      .set({
        status: to,
        ...(to === "released" ? { released_at: sql<Date>`now()` } : {}),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", id)
      .where("status", "=", from)
      .returningAll()
      .executeTakeFirst();
    return row ? (await this.withParticipants([row]))[0] : null;
  }

  async draftsOwnedBy(userId: string): Promise<Contract[]> {
    const rows = await this.db
      .selectFrom("contracts")
      .selectAll()
      .where("owner_id", "=", userId)
      .where("status", "=", "draft")
      .execute();
    return this.withParticipants(rows);
  }

  private async withParticipants(
    rows: Selectable<ContractsTable>[],
  ): Promise<Contract[]> {
    if (rows.length === 0) return [];
    const participants = await this.db
      .selectFrom("participants")
      .selectAll()
      .where(
        "contract_id",
        "in",
        rows.map((r) => r.id),
      )
      .orderBy("position")
      .execute();
    return rows.map((row) => {
      const own = participants.filter((p) => p.contract_id === row.id);
      return toContract(
        row,
        own.find((p) => p.role === "accessor")?.user_id ?? "",
        own.filter((p) => p.role === "validator").map((p) => p.user_id),
      );
    });
  }
}

class KyselySealings implements SealingRepository {
  constructor(private readonly db: Db) {}

  async find(contractId: string): Promise<Sealing | null> {
    const row = await this.db
      .selectFrom("envelopes")
      .selectAll()
      .where("contract_id", "=", contractId)
      .executeTakeFirst();
    if (!row) return null;
    const shares = await this.db
      .selectFrom("key_wraps")
      .selectAll()
      .where("contract_id", "=", contractId)
      .orderBy("share_index")
      .execute();
    return {
      sealedVersion: row.sealed_version,
      envelope: new Uint8Array(row.envelope),
      envelopeHash: row.envelope_hash,
      manifestText: row.manifest,
      manifestSignature: new Uint8Array(row.manifest_signature),
      ownerWrap: new Uint8Array(row.owner_wrap),
      ownerKeyVersion: row.owner_key_version,
      shares: shares.map((s) => ({
        userId: s.user_id,
        index: s.share_index,
        keyVersion: s.key_version,
        wrap: new Uint8Array(s.wrap),
      })),
    };
  }

  async replace(contractId: string, sealing: Sealing): Promise<void> {
    await this.delete(contractId);
    await this.db
      .insertInto("envelopes")
      .values({
        contract_id: contractId,
        sealed_version: sealing.sealedVersion,
        envelope: sealing.envelope,
        envelope_hash: sealing.envelopeHash,
        manifest: sealing.manifestText,
        manifest_signature: sealing.manifestSignature,
        owner_wrap: sealing.ownerWrap,
        owner_key_version: sealing.ownerKeyVersion,
      })
      .execute();
    await this.db
      .insertInto("key_wraps")
      .values(
        sealing.shares.map((s) => ({
          contract_id: contractId,
          share_index: s.index,
          user_id: s.userId,
          key_version: s.keyVersion,
          wrap: s.wrap,
        })),
      )
      .execute();
  }

  async delete(contractId: string): Promise<void> {
    // Wraps go with their envelope (on delete cascade).
    await this.db
      .deleteFrom("envelopes")
      .where("contract_id", "=", contractId)
      .execute();
  }

  async manifests(contractIds: string[]): Promise<Map<string, string>> {
    if (contractIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom("envelopes")
      .select(["contract_id", "manifest"])
      .where("contract_id", "in", contractIds)
      .execute();
    return new Map(rows.map((r) => [r.contract_id, r.manifest]));
  }
}

class KyselyClaims implements ClaimRepository {
  constructor(private readonly db: Db) {}

  async find(claimId: string): Promise<Claim | null> {
    const row = await this.db
      .selectFrom("claims")
      .selectAll()
      .where("id", "=", claimId)
      .executeTakeFirst();
    return row ? toClaim(row) : null;
  }

  async openFor(contractIds: string[]): Promise<Claim[]> {
    if (contractIds.length === 0) return [];
    const rows = await this.db
      .selectFrom("claims")
      .selectAll()
      .where("contract_id", "in", contractIds)
      .where("status", "=", "open")
      .execute();
    return rows.map(toClaim);
  }

  async released(contractId: string): Promise<Claim | null> {
    const row = await this.db
      .selectFrom("claims")
      .selectAll()
      .where("contract_id", "=", contractId)
      .where("status", "=", "released")
      .executeTakeFirst();
    return row ? toClaim(row) : null;
  }

  async lastClosedBy(
    claimantId: string,
    contractIds: string[],
  ): Promise<Claim[]> {
    if (contractIds.length === 0) return [];
    const rows = await this.db
      .selectFrom("claims")
      .selectAll()
      .distinctOn("contract_id")
      .where("claimant_id", "=", claimantId)
      .where("contract_id", "in", contractIds)
      .where("status", "!=", "open")
      .orderBy("contract_id")
      .orderBy("closed_at", "desc")
      .execute();
    return rows.map(toClaim);
  }

  async insert(
    claim: Pick<
      Claim,
      | "contractId"
      | "claimantId"
      | "sealedVersion"
      | "filedAt"
      | "contestUntil"
      | "expiresAt"
    >,
  ): Promise<Claim> {
    const row = await this.db
      .insertInto("claims")
      .values({
        contract_id: claim.contractId,
        claimant_id: claim.claimantId,
        sealed_version: claim.sealedVersion,
        filed_at: claim.filedAt,
        contest_until: claim.contestUntil,
        expires_at: claim.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toClaim(row);
  }

  async close(
    claimId: string,
    status: Exclude<ClaimStatus, "open">,
    closedBy: string | null,
    at: Date,
  ): Promise<boolean> {
    const row = await this.db
      .updateTable("claims")
      .set({ status, closed_by: closedBy, closed_at: at })
      .where("id", "=", claimId)
      .where("status", "=", "open")
      .returning("id")
      .executeTakeFirst();
    return row !== undefined;
  }

  async decisions(claimIds: string[]): Promise<Map<string, Decision[]>> {
    const result = new Map<string, Decision[]>(claimIds.map((id) => [id, []]));
    if (claimIds.length === 0) return result;
    const rows = await this.db
      .selectFrom("decisions")
      .selectAll()
      .where("claim_id", "in", claimIds)
      .orderBy("decided_at")
      .execute();
    for (const row of rows) {
      result.get(row.claim_id)!.push({
        validatorId: row.validator_id,
        approve: row.approve,
        shareIndex: row.share_index,
        accessorKeyVersion: row.accessor_key_version,
        releaseWrap: row.release_wrap ? new Uint8Array(row.release_wrap) : null,
      });
    }
    return result;
  }

  async decide(claimId: string, decision: Decision): Promise<boolean> {
    const row = await this.db
      .insertInto("decisions")
      .values({
        claim_id: claimId,
        validator_id: decision.validatorId,
        approve: decision.approve,
        share_index: decision.shareIndex,
        accessor_key_version: decision.accessorKeyVersion,
        release_wrap: decision.releaseWrap,
      })
      .onConflict((oc) => oc.columns(["claim_id", "validator_id"]).doNothing())
      .returning("claim_id")
      .executeTakeFirst();
    return row !== undefined;
  }

  async eraseReleaseWraps(claimId: string): Promise<void> {
    await this.db
      .updateTable("decisions")
      .set({ release_wrap: null })
      .where("claim_id", "=", claimId)
      .execute();
  }

  async due(now: Date): Promise<Claim[]> {
    const rows = await this.db
      .selectFrom("claims")
      .selectAll()
      .where("status", "=", "open")
      .where((eb) =>
        eb.or([eb("contest_until", "<=", now), eb("expires_at", "<=", now)]),
      )
      .orderBy("contest_until")
      .execute();
    return rows.map(toClaim);
  }
}

function toClaim(row: Selectable<ClaimsTable>): Claim {
  return {
    id: row.id,
    contractId: row.contract_id,
    claimantId: row.claimant_id,
    sealedVersion: row.sealed_version,
    status: row.status as ClaimStatus,
    filedAt: row.filed_at,
    contestUntil: row.contest_until,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

class KyselyAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}

  async append(
    contractId: string,
    actorId: string | null,
    entry: AuditEntry,
  ): Promise<void> {
    // RFC 8785: the same object always gives the same text, so the hash is reproducible.
    const body = canonicalize(entry.body);
    if (body === undefined) throw new Error("Audit body is not serialisable");
    await sql`select handover.append_event(${contractId}::uuid, ${entry.type}, ${actorId}, ${body})`.execute(
      this.db,
    );
  }

  async list(contractId: string): Promise<ChainEvent[]> {
    return this.db
      .selectFrom("contract_events")
      .select([
        "contract_id",
        "seq",
        "type",
        "actor_id",
        "body",
        "occurred_at",
        "prev_hash",
        "hash",
      ])
      .where("contract_id", "=", contractId)
      .orderBy("seq")
      .execute();
  }

  async contractIds(): Promise<string[]> {
    const rows = await this.db
      .selectFrom("contract_events")
      .select("contract_id")
      .distinct()
      .orderBy("contract_id")
      .execute();
    return rows.map((r) => r.contract_id);
  }
}

function store(db: Executor): HandoverStore {
  const scoped = handover(db);
  const outbox = new TransactionalOutbox(db, {
    schema: "handover",
    context: { correlationId: currentCorrelationId() ?? newId() },
    clock: systemClock,
  });
  const events: EventPublisher = {
    publish: async (event, options) => {
      await outbox.publish(event, options);
    },
  };
  return {
    contracts: new KyselyContracts(scoped),
    sealings: new KyselySealings(scoped),
    claims: new KyselyClaims(scoped),
    audit: new KyselyAuditLog(scoped),
    events,
  };
}

/** Handover's repositories on its connection (svc_handover) or one of its transactions. */
@Injectable()
export class KyselyHandoverStores implements HandoverStores {
  readonly root: HandoverStore;

  constructor(@Inject(DATABASE) private readonly db: Kysely<any>) {
    this.root = store(db);
  }

  bind(tx: Executor): HandoverStore {
    return store(tx);
  }

  transaction<T>(work: (store: HandoverStore) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((tx) => work(store(tx)));
  }
}

function toContract(
  row: Selectable<ContractsTable>,
  accessorId: string,
  validatorIds: string[],
): Contract {
  return {
    id: row.id,
    ownerId: row.owner_id,
    category: row.category as Category,
    description: row.description,
    status: row.status as Status,
    version: row.version,
    sealedVersion: row.sealed_version,
    contestDays: row.contest_days,
    accessorId,
    validatorIds,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
