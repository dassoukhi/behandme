import { ClaimClosed, ContractRevoked, ParticipantLeft } from "@lib/contracts";
import { ConflictError } from "@lib/kernel";
import {
  claimClosed,
  type ClosedReason,
  contractRevoked,
  participantLeft,
} from "../domain/audit-events.js";
import { type Claim, type ClaimStatus, tallyFor } from "../domain/claims.js";
import {
  type Contract,
  type LeftReason,
  presentParticipants,
} from "../domain/contract.js";
import type { HandoverStore } from "./ports.js";

// How claims and contracts end, and how a participant leaves, shared by the users' actions (cancel, revoke,
// refuse a role…) and the account-deletion saga: each erases what it must, writes its audit event and tells
// the people concerned.

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
      validatorIds: presentParticipants(contract).validatorIds,
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
      ...presentParticipants(contract),
    }),
  );
  return revoked;
}

/**
 * A participant leaves: they refused their role (`actor`: them), or their account is gone (the system). They
 * stay named, but no longer see the contract and are told nothing more about it; their share or their access
 * goes unused until the owner seals again. An open claim closes when it can no longer succeed: they filed it,
 * it would release to them, or too few validators are left to approve it. The owner is told.
 */
export async function leaveContract(
  store: HandoverStore,
  contract: Contract,
  departure: { userId: string; reason: LeftReason; at: Date },
): Promise<Contract> {
  const { userId, reason, at } = departure;
  const role = contract.accessorId === userId ? "accessor" : "validator";
  const actor = reason === "declined" ? userId : null;
  let current = await store.contracts.markLeft(contract.id, userId, {
    reason,
    at,
  });
  if (!current) {
    throw new ConflictError("You are no longer a participant of this contract");
  }
  // Locked, as for a decision: one arriving meanwhile waits, and sees the departure once it is committed.
  const [open] = await store.claims.openFor([contract.id]);
  const claim = open ? await store.claims.lockOpen(open.id) : null;
  if (claim) {
    const decisions =
      (await store.claims.decisions([claim.id])).get(claim.id) ?? [];
    if (
      claim.claimantId === userId ||
      role === "accessor" ||
      tallyFor(current, decisions).rejected
    ) {
      await closeClaim(store, current, claim, {
        status: "cancelled",
        reason: "participant_left",
        closedBy: actor,
        at,
      });
      current = await store.contracts.transition(
        contract.id,
        "claimed",
        "active",
      );
      if (!current) throw new ConflictError("The contract changed meanwhile");
    }
  }
  await store.audit.append(contract.id, actor, participantLeft(role, reason));
  await store.events.publish(
    ParticipantLeft.create({
      contractId: contract.id,
      category: contract.category,
      ownerId: contract.ownerId,
      participantId: userId,
      role,
      reason,
    }),
  );
  return current;
}
