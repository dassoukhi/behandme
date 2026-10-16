import { Inject, Injectable } from "@nestjs/common";
import {
  ClaimDeadlineDue,
  ClaimFiled,
  ClaimQuorumReached,
  ClaimReminder,
  ClaimReminderDue,
  type ContractRecord,
  ContractReleased,
  type ReleasePackage,
} from "@lib/contracts";
import {
  type Clock,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from "@lib/kernel";
import {
  claimDecided,
  claimFiled,
  contractReleased,
} from "../domain/audit-events.js";
import {
  assertApproval,
  type Claim,
  claimDeadlines,
  cooldownUntil,
  type Decision,
  reminderAt,
  settlement,
  type Tally,
  tally,
} from "../domain/claims.js";
import { type Contract, type Role, roleOf } from "../domain/contract.js";
import { type Action, assertAllowed } from "../domain/lifecycle.js";
import type { RegisteredKey } from "../domain/sealing.js";
import {
  CLOCK,
  CONTEST_OVERRIDE,
  HANDOVER_STORES,
  type HandoverStore,
  type HandoverStores,
} from "./ports.js";
import { closeClaim } from "./endings.js";
import { recordsFor } from "./records.js";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

type EndReason = "cancelled" | "withdrawn" | "rejected" | "expired";

/**
 * Claims and release (docs/architecture.md, "Contract life cycle"). Each change commits with its audit
 * event and the events for the other services; the end of the contest window comes back as a delayed
 * message (claim.deadline_due), and the worker's hourly tick catches up any that went missing.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(HANDOVER_STORES) private readonly stores: HandoverStores,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONTEST_OVERRIDE) private readonly contestOverrideMs: number | null,
  ) {}

  /** The accessor or a validator says the owner can no longer act. */
  async file(me: string, id: string): Promise<ContractRecord> {
    return this.stores.transaction(async (store) => {
      const now = this.clock.now();
      const { contract, role } = await visible(store, me, id);
      const [last] = await store.claims.lastClosedBy(me, [id]);
      assertAllowed("claim", contract, role, {
        me,
        claim: null,
        cooldownUntil: cooldownUntil(last ?? null, now),
      });
      const claimed = await store.contracts.transition(id, "active", "claimed");
      if (!claimed) {
        throw new ConflictError("The contract changed meanwhile: try again");
      }
      const claim = await store.claims.insert({
        contractId: id,
        claimantId: me,
        sealedVersion: contract.sealedVersion,
        filedAt: now,
        ...claimDeadlines(contract, now, this.contestOverrideMs),
      });
      await store.audit.append(
        id,
        me,
        claimFiled({ claimId: claim.id, contestUntil: claim.contestUntil }),
      );
      await store.events.publish(
        ClaimFiled.create({
          contractId: id,
          claimId: claim.id,
          category: contract.category,
          ownerId: contract.ownerId,
          claimantId: me,
          validatorIds: contract.validatorIds,
          contestUntil: claim.contestUntil.toISOString(),
        }),
      );
      await store.events.publish(
        ClaimReminderDue.create({ contractId: id, claimId: claim.id }),
        { deliverAt: reminderAt(claim) },
      );
      await store.events.publish(
        ClaimDeadlineDue.create({ contractId: id, claimId: claim.id }),
        { deliverAt: claim.contestUntil },
      );
      return this.record(store, me, claimed);
    });
  }

  /** "I'm here": the owner stops the claim. */
  cancel(me: string, id: string, claimId: string): Promise<ContractRecord> {
    return this.endByUser(me, id, claimId, "cancel_claim", "cancelled");
  }

  /** The claimant takes their claim back. */
  withdraw(me: string, id: string, claimId: string): Promise<ContractRecord> {
    return this.endByUser(me, id, claimId, "withdraw_claim", "withdrawn");
  }

  /**
   * A validator's decision, once. Approving brings their share re-wrapped to the accessor, checked
   * against `accessorKey` (the accessor's current registered keys, given by the gateway). Enough
   * rejections close the claim; enough approvals release it once the contest window is over.
   */
  async decide(
    me: string,
    id: string,
    claimId: string,
    decision: {
      approve: boolean;
      releaseWrap?: Uint8Array;
      accessorKeyVersion?: number;
    },
    accessorKey: RegisteredKey | undefined,
  ): Promise<ContractRecord> {
    return this.stores.transaction(async (store) => {
      const now = this.clock.now();
      const { contract, role, claim, decisions } = await this.withOpenClaim(
        store,
        me,
        id,
        claimId,
      );
      this.assertAllowed("decide", contract, role, me, claim, decisions);
      const n = contract.validatorIds.length;
      let recorded: Decision = {
        validatorId: me,
        approve: false,
        shareIndex: null,
        accessorKeyVersion: null,
        releaseWrap: null,
      };
      if (decision.approve) {
        const { releaseWrap, accessorKeyVersion } = decision;
        if (!releaseWrap || accessorKeyVersion === undefined) {
          throw new InvalidInputError(
            "Approving needs the share re-wrapped to the accessor",
          );
        }
        assertApproval(
          { releaseWrap, accessorKeyVersion },
          n,
          accessorKey,
          now,
        );
        const share = (await store.sealings.find(id))?.shares.find(
          (s) => s.userId === me,
        );
        if (!share)
          throw new ConflictError("You hold no share of this sealing");
        recorded = {
          validatorId: me,
          approve: true,
          shareIndex: share.index,
          accessorKeyVersion,
          releaseWrap,
        };
      }
      if (!(await store.claims.decide(claim.id, recorded))) {
        throw new ConflictError("You already decided on this claim");
      }
      await store.audit.append(
        id,
        me,
        claimDecided({ claimId: claim.id, approve: recorded.approve }),
      );

      const before = tally(decisions, n);
      const after = tally([...decisions, recorded], n);
      let current = contract;
      if (after.rejected) {
        current = await this.end(store, contract, claim, "rejected", null);
      } else if (after.quorum) {
        if (!before.quorum) {
          await store.events.publish(
            ClaimQuorumReached.create({
              contractId: id,
              claimId: claim.id,
              category: contract.category,
              ownerId: contract.ownerId,
              contestUntil: claim.contestUntil.toISOString(),
            }),
          );
        }
        if (settlement(claim, after, now) === "release") {
          current = await this.release(store, contract, claim, after);
        }
      }
      return this.record(store, me, current);
    });
  }

  /** The end of a claim's contest window (delayed message): release, expire, or keep waiting. */
  async settle(store: HandoverStore, claimId: string): Promise<string> {
    const claim = await store.claims.find(claimId);
    if (!claim || claim.status !== "open") return "closed";
    const contract = await store.contracts.find(claim.contractId);
    if (!contract) return "closed";
    const decisions =
      (await store.claims.decisions([claim.id])).get(claim.id) ?? [];
    const result = tally(decisions, contract.validatorIds.length);
    const outcome = settlement(claim, result, this.clock.now());
    if (outcome === "release") {
      await this.release(store, contract, claim, result);
    } else if (outcome === "expire") {
      await this.end(store, contract, claim, "expired", null);
    }
    return outcome;
  }

  /** A day before the deadline: the owner may still cancel; validators who have not decided are asked again. */
  async remind(store: HandoverStore, claimId: string): Promise<boolean> {
    const claim = await store.claims.find(claimId);
    if (!claim || claim.status !== "open") return false;
    const contract = await store.contracts.find(claim.contractId);
    if (!contract) return false;
    const decisions =
      (await store.claims.decisions([claim.id])).get(claim.id) ?? [];
    const decided = new Set(decisions.map((d) => d.validatorId));
    await store.events.publish(
      ClaimReminder.create({
        contractId: contract.id,
        claimId: claim.id,
        category: contract.category,
        ownerId: contract.ownerId,
        pendingValidatorIds: contract.validatorIds.filter(
          (v) => !decided.has(v) && v !== claim.claimantId,
        ),
        quorum: tally(decisions, contract.validatorIds.length).quorum,
        contestUntil: claim.contestUntil.toISOString(),
      }),
    );
    return true;
  }

  /** Every open claim past its deadline (the worker's catch-up tick). */
  async settleDue(
    store: HandoverStore,
  ): Promise<{ released: number; expired: number }> {
    let released = 0;
    let expired = 0;
    for (const claim of await store.claims.due(this.clock.now())) {
      const outcome = await this.settle(store, claim.id);
      if (outcome === "release") released++;
      if (outcome === "expire") expired++;
    }
    return { released, expired };
  }

  /** The accessor's download once released: the envelope and the shares re-wrapped to them. */
  async releasePackage(me: string, id: string): Promise<ReleasePackage> {
    const store = this.stores.root;
    const { contract, role } = await visible(store, me, id);
    assertAllowed("open", contract, role);
    const [claim, sealing] = await Promise.all([
      store.claims.released(id),
      store.sealings.find(id),
    ]);
    if (!claim || !sealing) throw new NotFoundError("Nothing was released");
    const decisions =
      (await store.claims.decisions([claim.id])).get(claim.id) ?? [];
    return {
      sealed_version: sealing.sealedVersion,
      manifest: JSON.parse(sealing.manifestText) as Record<string, unknown>,
      manifest_signature: b64(sealing.manifestSignature),
      envelope: b64(sealing.envelope),
      claim_id: claim.id,
      shares: decisions
        .filter((d) => d.approve && d.releaseWrap)
        .map((d) => ({
          index: d.shareIndex!,
          key_version: d.accessorKeyVersion!,
          wrap: b64(d.releaseWrap!),
        })),
    };
  }

  private async endByUser(
    me: string,
    id: string,
    claimId: string,
    action: Action,
    reason: "cancelled" | "withdrawn",
  ): Promise<ContractRecord> {
    return this.stores.transaction(async (store) => {
      const { contract, role, claim, decisions } = await this.withOpenClaim(
        store,
        me,
        id,
        claimId,
      );
      this.assertAllowed(action, contract, role, me, claim, decisions);
      const active = await this.end(store, contract, claim, reason, me);
      return this.record(store, me, active);
    });
  }

  /** Ends an open claim without release: the contract is active again, re-wrapped shares erased. */
  private async end(
    store: HandoverStore,
    contract: Contract,
    claim: Claim,
    reason: EndReason,
    closedBy: string | null,
  ): Promise<Contract> {
    await closeClaim(store, contract, claim, {
      status: reason,
      reason,
      closedBy,
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

  /** Quorum reached and contest window over: the accessor may now open the contract. */
  private async release(
    store: HandoverStore,
    contract: Contract,
    claim: Claim,
    result: Tally,
  ): Promise<Contract> {
    if (
      !(await store.claims.close(claim.id, "released", null, this.clock.now()))
    ) {
      throw new ConflictError("This claim is no longer open");
    }
    const released = await store.contracts.transition(
      contract.id,
      "claimed",
      "released",
    );
    if (!released) throw new ConflictError("The contract changed meanwhile");
    await store.audit.append(
      contract.id,
      null,
      contractReleased({ claimId: claim.id, approvals: result.approvals }),
    );
    await store.events.publish(
      ContractReleased.create({
        contractId: contract.id,
        claimId: claim.id,
        category: contract.category,
        ownerId: contract.ownerId,
        accessorId: contract.accessorId,
        validatorIds: contract.validatorIds,
      }),
    );
    return released;
  }

  private async withOpenClaim(
    store: HandoverStore,
    me: string,
    id: string,
    claimId: string,
  ): Promise<{
    contract: Contract;
    role: Role;
    claim: Claim;
    decisions: Decision[];
  }> {
    const { contract, role } = await visible(store, me, id);
    const [claim] = await store.claims.openFor([id]);
    if (!claim || claim.id !== claimId) {
      throw new ConflictError("This claim is no longer open");
    }
    const decisions =
      (await store.claims.decisions([claim.id])).get(claim.id) ?? [];
    return { contract, role, claim, decisions };
  }

  private assertAllowed(
    action: Action,
    contract: Contract,
    role: Role,
    me: string,
    claim: Claim,
    decisions: Decision[],
  ): void {
    assertAllowed(action, contract, role, {
      me,
      claim: {
        claimantId: claim.claimantId,
        decidedByMe: decisions.some((d) => d.validatorId === me),
      },
      cooldownUntil: null,
    });
  }

  private async record(
    store: HandoverStore,
    me: string,
    contract: Contract,
  ): Promise<ContractRecord> {
    return (await recordsFor(store, me, [contract], this.clock.now()))[0];
  }
}

async function visible(
  store: HandoverStore,
  me: string,
  id: string,
): Promise<{ contract: Contract; role: Role }> {
  const contract = await store.contracts.find(id);
  const role = contract ? roleOf(contract, me) : null;
  if (!contract || !role) throw new NotFoundError("Contract not found");
  return { contract, role };
}
