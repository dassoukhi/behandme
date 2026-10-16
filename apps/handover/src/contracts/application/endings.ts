import { ClaimClosed, ContractRevoked } from "@lib/contracts";
import { ConflictError } from "@lib/kernel";
import {
  claimClosed,
  type ClosedReason,
  contractRevoked,
} from "../domain/audit-events.js";
import type { Claim, ClaimStatus } from "../domain/claims.js";
import type { Contract } from "../domain/contract.js";
import type { HandoverStore } from "./ports.js";

// How claims and contracts end, shared by the users' actions (cancel, revoke…) and the account-deletion
// saga: each ending erases what it must, writes its audit event and tells the people concerned.

/**
 * Closes an open claim without release: the shares re-wrapped to the accessor are erased. The
 * contract's own status is left to the caller.
 */
export async function closeClaim(
  store: HandoverStore,
  contract: Contract,
  claim: Claim,
  close: {
    status: Exclude<ClaimStatus, "open" | "released">;
    reason: ClosedReason;
    closedBy: string | null;
    at: Date;
  },
): Promise<void> {
  if (
    !(await store.claims.close(
      claim.id,
      close.status,
      close.closedBy,
      close.at,
    ))
  ) {
    throw new ConflictError("This claim is no longer open");
  }
  await store.claims.eraseReleaseWraps(claim.id);
  await store.audit.append(
    contract.id,
    close.closedBy,
    claimClosed({ claimId: claim.id, reason: close.reason }),
  );
  await store.events.publish(
    ClaimClosed.create({
      contractId: contract.id,
      claimId: claim.id,
      category: contract.category,
      reason: close.reason,
      closedBy: close.closedBy,
      ownerId: contract.ownerId,
      claimantId: claim.claimantId,
      validatorIds: contract.validatorIds,
    }),
  );
}

/**
 * Revokes a contract: its open claim closes, every ciphertext is deleted (nobody can ever open it),
 * and the accessor and validators are told. `actor`: the owner, or null for the system.
 */
export async function revokeContract(
  store: HandoverStore,
  contract: Contract,
  revocation: {
    actor: string | null;
    reason: "owner" | "account_deleted";
    at: Date;
  },
): Promise<Contract> {
  const revoked = await store.contracts.markRevoked(
    contract.id,
    contract.version,
  );
  if (!revoked) {
    throw new ConflictError(
      "The contract changed meanwhile: reload it and try again",
    );
  }
  await store.sealings.delete(contract.id);
  const [claim] = await store.claims.openFor([contract.id]);
  if (claim) {
    await closeClaim(store, contract, claim, {
      status: "cancelled",
      reason: "revoked",
      closedBy: revocation.actor,
      at: revocation.at,
    });
  }
  await store.audit.append(
    contract.id,
    revocation.actor,
    contractRevoked(
      revocation.reason === "owner" ? undefined : revocation.reason,
    ),
  );
  await store.events.publish(
    ContractRevoked.create({
      contractId: contract.id,
      category: contract.category,
      reason: revocation.reason,
      ownerId: contract.ownerId,
      accessorId: contract.accessorId,
      validatorIds: contract.validatorIds,
    }),
  );
  return revoked;
}
