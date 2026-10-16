import { Inject, Injectable } from "@nestjs/common";
import type {
  AuditEvent,
  ChainVerification,
  ContractRecord,
} from "@lib/contracts";
import { type Clock, ConflictError, NotFoundError } from "@lib/kernel";
import {
  contractCreated,
  contractDeleted,
  contractUpdated,
} from "../domain/audit-events.js";
import { verifyChain } from "../domain/audit-chain.js";
import {
  assertValidDraft,
  assertValidFields,
  changedFields,
  type Contract,
  type ContractChanges,
  type DraftInput,
  type Role,
  roleOf,
} from "../domain/contract.js";
import { assertAllowed } from "../domain/lifecycle.js";
import { recordsFor } from "./records.js";
import {
  CLOCK,
  HANDOVER_STORES,
  type HandoverStore,
  type HandoverStores,
  SHA256,
  type Sha256Hex,
} from "./ports.js";

/**
 * Contracts as their participants see and change them. Every change writes its audit event in the
 * same transaction. A contract the user takes no part in answers "not found".
 */
@Injectable()
export class ContractsService {
  constructor(
    @Inject(HANDOVER_STORES) private readonly stores: HandoverStores,
    @Inject(SHA256) private readonly sha256: Sha256Hex,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(me: string): Promise<ContractRecord[]> {
    const contracts = await this.stores.root.contracts.listFor(me);
    return recordsFor(this.stores.root, me, contracts, this.clock.now());
  }

  async get(me: string, id: string): Promise<ContractRecord> {
    const { contract } = await this.visible(this.stores.root, me, id);
    return this.record(this.stores.root, me, contract);
  }

  async create(me: string, input: DraftInput): Promise<ContractRecord> {
    assertValidDraft(me, input);
    return this.stores.transaction(async (store) => {
      const contract = await store.contracts.insert(me, input);
      await store.audit.append(contract.id, me, contractCreated(contract));
      return this.record(store, me, contract);
    });
  }

  async update(
    me: string,
    id: string,
    changes: ContractChanges,
  ): Promise<ContractRecord> {
    assertValidFields(changes);
    return this.stores.transaction(async (store) => {
      const { contract, role } = await this.visible(store, me, id);
      assertAllowed("update", contract, role);
      const fields = changedFields(contract, changes);
      if (fields.length === 0) return this.record(store, me, contract);
      const updated = await store.contracts.update(
        id,
        Object.fromEntries(fields.map((f) => [f, changes[f]])),
        contract.version,
      );
      if (!updated) {
        throw new ConflictError("The contract changed meanwhile: try again");
      }
      await store.audit.append(id, me, contractUpdated(fields));
      return this.record(store, me, updated);
    });
  }

  /** Deletes a draft; its audit log stays, ending with contract.deleted. */
  async remove(me: string, id: string): Promise<void> {
    await this.stores.transaction(async (store) => {
      const { contract, role } = await this.visible(store, me, id);
      assertAllowed("delete", contract, role);
      await store.contracts.delete(id);
      await store.audit.append(id, me, contractDeleted("owner"));
    });
  }

  async events(me: string, id: string): Promise<AuditEvent[]> {
    await this.visible(this.stores.root, me, id);
    return (await this.stores.root.audit.list(id)).map((event) => ({
      seq: event.seq,
      type: event.type,
      actor_id: event.actor_id,
      body: event.body,
      occurred_at: event.occurred_at,
      prev_hash: event.prev_hash,
      hash: event.hash,
    }));
  }

  async verify(me: string, id: string): Promise<ChainVerification> {
    await this.visible(this.stores.root, me, id);
    const check = verifyChain(
      id,
      await this.stores.root.audit.list(id),
      this.sha256,
    );
    return {
      ok: check.ok,
      length: check.length,
      head_hash: check.headHash,
      broken_at: check.brokenAt,
    };
  }

  private async record(
    store: HandoverStore,
    me: string,
    contract: Contract,
  ): Promise<ContractRecord> {
    return (await recordsFor(store, me, [contract], this.clock.now()))[0];
  }

  private async visible(
    store: HandoverStore,
    me: string,
    id: string,
  ): Promise<{ contract: Contract; role: Role }> {
    const contract = await store.contracts.find(id);
    const role = contract ? roleOf(contract, me) : null;
    if (!contract || !role) throw new NotFoundError("Contract not found");
    return { contract, role };
  }
}
