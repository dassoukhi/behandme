import type { Contract, ContractChanges } from "./contract.js";

// What the audit log records. Bodies hold ids, categories and field names only: the log is kept for
// ever, so no free text (a description may be personal) and never anything secret.

export interface AuditEntry {
  type: string;
  body: Record<string, unknown>;
}

export function contractCreated(contract: Contract): AuditEntry {
  return {
    type: "contract.created",
    body: {
      category: contract.category,
      accessor_id: contract.accessorId,
      validator_ids: contract.validatorIds,
    },
  };
}

export function contractUpdated(fields: (keyof ContractChanges)[]): AuditEntry {
  return { type: "contract.updated", body: { fields: [...fields].sort() } };
}

/** Hashes and ids only: the ciphertexts themselves stay out of the log. */
export function contractSealed(sealing: {
  sealedVersion: number;
  envelopeHash: string;
  threshold: number;
  accessorId: string;
  validatorIds: string[];
}): AuditEntry {
  return {
    type: "contract.sealed",
    body: {
      sealed_version: sealing.sealedVersion,
      envelope_hash: sealing.envelopeHash,
      threshold: sealing.threshold,
      accessor_id: sealing.accessorId,
      validator_ids: sealing.validatorIds,
    },
  };
}

export function contractRevoked(): AuditEntry {
  return { type: "contract.revoked", body: {} };
}

export function contractDeleted(
  reason: "owner" | "account_deleted",
): AuditEntry {
  return { type: "contract.deleted", body: { reason } };
}

export function claimFiled(claim: {
  claimId: string;
  contestUntil: Date;
}): AuditEntry {
  return {
    type: "claim.filed",
    body: {
      claim_id: claim.claimId,
      contest_until: claim.contestUntil.toISOString(),
    },
  };
}

/** A validator's decision; an approval's re-wrapped share stays out of the log. */
export function claimDecided(decision: {
  claimId: string;
  approve: boolean;
}): AuditEntry {
  return {
    type: "claim.decided",
    body: { claim_id: decision.claimId, approve: decision.approve },
  };
}

export function claimClosed(closing: {
  claimId: string;
  reason: "cancelled" | "withdrawn" | "rejected" | "expired" | "revoked";
}): AuditEntry {
  return {
    type: "claim.closed",
    body: { claim_id: closing.claimId, reason: closing.reason },
  };
}

export function contractReleased(release: {
  claimId: string;
  approvals: number;
}): AuditEntry {
  return {
    type: "contract.released",
    body: { claim_id: release.claimId, approvals: release.approvals },
  };
}
