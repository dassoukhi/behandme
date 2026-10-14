import { Inject, Injectable } from "@nestjs/common";
import canonicalize from "canonicalize";
import { type Kysely, type Selectable, sql } from "kysely";
import type { Executor } from "@lib/messaging";
import { DATABASE } from "@lib/platform";
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
  ContractRepository,
  HandoverStore,
  HandoverStores,
} from "../application/ports.js";
import type { ContractsTable, HandoverDatabase } from "./tables.js";

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
    const row = await this.db
      .updateTable("contracts")
      .set({
        ...changes,
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
  return {
    contracts: new KyselyContracts(scoped),
    audit: new KyselyAuditLog(scoped),
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
    accessorId,
    validatorIds,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
