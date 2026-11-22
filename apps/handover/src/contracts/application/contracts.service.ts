import { Inject, Injectable } from "@nestjs/common";
import {
  type AuditEvent,
  type ChainVerification,
  type ContractRecord,
  ContractRulesChanged,
} from "@lib/contracts";
import { type Clock, ConflictError, NotFoundError } from "@lib/kernel";
import {
  contractCreated,
  contractDeleted,
  contractUpdated,
  incapacityConsent,
} from "../domain/audit-events.js";
import { verifyChain } from "../domain/audit-chain.js";
import {
  assertCategoryRules,
  assertValidDraft,
  assertValidFields,
  changedFields,
  type Contract,
  type ContractChanges,
  type DraftInput,
  presentParticipants,
  type Role,
  roleOf,
} from "../domain/contract.js";
import { assertAllowed } from "../domain/lifecycle.js";
import { closeClaim, leaveContract } from "./endings.js";
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
      if (contract.incapacityAllowed) {
        await store.audit.append(contract.id, me, incapacityConsent(true));
      }
      return this.record(store, me, contract);
    });
  }

  /**
   * The owner's edit (draft or active). A consent to a claim for an incapacity may be withdrawn at any time before the
   * end, even during a claim, which then closes if it gave this reason. Once sealed, those named are told of a change to
   * that consent: it changes when they may be asked to approve.
   */
  async update(
    me: string,
    id: string,
    changes: ContractChanges,
  ): Promise<ContractRecord> {
    assertValidFields(changes);
    const given = Object.entries(changes).filter(([, v]) => v !== undefined);
    const consentOnly =
      given.length === 1 && given[0][0] === "incapacityAllowed";
    const withdrawal = consentOnly && given[0][1] === false;
    const grant = consentOnly && given[0][1] === true;
    return this.stores.transaction(async (store) => {
      // Locked first (ports.ts, lock): a withdrawal may close the open claim.
      const contract = await store.contracts.lock(id);
      const role = contract ? roleOf(contract, me) : null;
      if (!contract || !role) throw new NotFoundError("Contract not found");
      if (withdrawal && !contract.incapacityAllowed) {
        if (role !== "owner") throw new NotFoundError("Contract not found");
        return this.record(store, me, contract);
      }
      assertAllowed(
        withdrawal ? "withdraw_consent" : grant ? "grant_consent" : "update",
        contract,
        role,
      );
      const fields = changedFields(contract, changes);
      if (fields.length === 0) return this.record(store, me, contract);
      const changed: ContractChanges = Object.fromEntries(
        fields.map((f) => [f, changes[f]]),
      );
      // The contract as it would be: a category's rules hold for all of it (finances: 3 validators, 15 days…). A
      // draft's validators are only provisional: its sealing checks those it names.
      assertCategoryRules({
        category: changed.category ?? contract.category,
        contestDays: changed.contestDays ?? contract.contestDays,
        incapacityAllowed:
          changed.incapacityAllowed ?? contract.incapacityAllowed,
        validatorCount:
          contract.status === "draft"
            ? undefined
            : contract.validatorIds.length,
      });
      const current =
        withdrawal && contract.status === "claimed"
          ? await this.closeIncapacityClaim(store, me, contract)
          : contract;
      const updated = await store.contracts.update(
        id,
        changed,
        current.version,
      );
      if (!updated) {
        throw new ConflictError("The contract changed meanwhile: try again");
      }
      // The consent has its own entry, with the wording accepted; other fields are named only.
      const named = fields.filter((f) => f !== "incapacityAllowed");
      if (named.length > 0) {
        await store.audit.append(id, me, contractUpdated(named));
      }
      if (changed.incapacityAllowed !== undefined) {
        await store.audit.append(
          id,
          me,
          incapacityConsent(changed.incapacityAllowed),
        );
        if (updated.sealedVersion > 0) {
          await store.events.publish(
            ContractRulesChanged.create({
              contractId: id,
              category: updated.category,
              ownerId: updated.ownerId,
              ...presentParticipants(updated),
              incapacityAllowed: updated.incapacityAllowed,
            }),
          );
        }
      }
      return this.record(store, me, updated);
    });
  }

  /** The owner withdrew their consent: a claim saying they can no longer act ends, as if they cancelled it. */
  private async closeIncapacityClaim(
    store: HandoverStore,
    me: string,
    contract: Contract,
  ): Promise<Contract> {
    const [open] = await store.claims.openFor([contract.id]);
    const claim = open ? await store.claims.lockOpen(open.id) : null;
    if (!claim || claim.reason !== "incapacity") return contract;
    await closeClaim(store, contract, claim, {
      status: "cancelled",
      reason: "cancelled",
      closedBy: me,
      at: this.clock.now(),
    });
    const active = await store.contracts.transition(
      contract.id,
      "claimed",
      "active",
    );
    if (!active) throw new ConflictError("The contract changed meanwhile");
    return active;
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

  /**
   * The accessor or a validator refuses their role (endings.ts, leaveContract): from then on the contract is
   * none of theirs, and the owner is told to choose someone else.
   */
  async leave(me: string, id: string): Promise<void> {
    await this.stores.transaction((store) =>
      leaveContract(store, id, {
        userId: me,
        reason: "declined",
        at: this.clock.now(),
      }),
    );
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
