import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "@lib/kernel";
import { contractDeleted } from "../domain/audit-events.js";
import { verifyChain } from "../domain/audit-chain.js";
import { type HandoverStore, SHA256, type Sha256Hex } from "./ports.js";

/** Handover's reactions to the other services' events. Each runs in the event's transaction. */
@Injectable()
export class HandoverEvents {
  constructor(@Inject(SHA256) private readonly sha256: Sha256Hex) {}

  /**
   * The account is gone: its drafts go too (they hold nothing). Contracts it takes part in are left
   * to the account-deletion saga (phase 6); the gateway refuses to delete such an account meanwhile.
   */
  async userDeleted(store: HandoverStore, userId: string): Promise<number> {
    const drafts = await store.contracts.draftsOwnedBy(userId);
    for (const draft of drafts) {
      await store.contracts.delete(draft.id);
      await store.audit.append(
        draft.id,
        null,
        contractDeleted("account_deleted"),
      );
    }
    return drafts.length;
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
