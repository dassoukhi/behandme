import { Inject, Injectable } from "@nestjs/common";
import { ParticipantLeft } from "@lib/contracts";
import type { Clock, Logger } from "@lib/kernel";
import { contractDeleted, participantLeft } from "../domain/audit-events.js";
import { verifyChain } from "../domain/audit-chain.js";
import { closeClaim, revokeContract } from "./endings.js";
import { CLOCK, type HandoverStore, SHA256, type Sha256Hex } from "./ports.js";

/** Handover's reactions to the other services' events. Each runs in the event's transaction. */
@Injectable()
export class HandoverEvents {
  constructor(
    @Inject(SHA256) private readonly sha256: Sha256Hex,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The account is gone (account deletion). Its drafts are deleted and its sealed contracts revoked:
   * nobody will open them. Released ones stay, for their accessor. In other people's contracts it
   * stays named but its keys are gone: a claim it filed, or that would release to it, is closed, and
   * the owner is told to re-seal with someone else.
   */
  async userDeleted(
    store: HandoverStore,
    userId: string,
  ): Promise<{ deleted: number; revoked: number; left: number }> {
    const now = this.clock.now();
    const result = { deleted: 0, revoked: 0, left: 0 };
    for (const contract of await store.contracts.listFor(userId)) {
      if (contract.ownerId === userId) {
        if (contract.status === "draft") {
          await store.contracts.delete(contract.id);
          await store.audit.append(
            contract.id,
            null,
            contractDeleted("account_deleted"),
          );
          result.deleted++;
        } else if (
          contract.status === "active" ||
          contract.status === "claimed"
        ) {
          await revokeContract(store, contract, {
            actor: null,
            reason: "account_deleted",
            at: now,
          });
          result.revoked++;
        }
        continue;
      }
      if (contract.status === "released" || contract.status === "revoked") {
        continue;
      }
      const role = contract.accessorId === userId ? "accessor" : "validator";
      const [claim] = await store.claims.openFor([contract.id]);
      if (claim && (claim.claimantId === userId || role === "accessor")) {
        await closeClaim(store, contract, claim, {
          status: "cancelled",
          reason: "participant_left",
          closedBy: null,
          at: now,
        });
        await store.contracts.transition(contract.id, "claimed", "active");
      }
      await store.audit.append(contract.id, null, participantLeft(role));
      await store.events.publish(
        ParticipantLeft.create({
          contractId: contract.id,
          category: contract.category,
          ownerId: contract.ownerId,
          role,
        }),
      );
      result.left++;
    }
    return result;
  }

  /** Checks every contract's chain; a broken one is an incident, logged as an error. */
  async verifyAll(
    store: HandoverStore,
    logger: Logger,
  ): Promise<{ checked: number; broken: string[] }> {
    const broken: string[] = [];
    const ids = await store.audit.contractIds();
    for (const id of ids) {
      const check = verifyChain(id, await store.audit.list(id), this.sha256);
      if (!check.ok) {
        broken.push(id);
        logger.error(
          `Audit log of contract ${id} is broken at event ${check.brokenAt}`,
        );
      }
    }
    return { checked: ids.length, broken };
  }
}
