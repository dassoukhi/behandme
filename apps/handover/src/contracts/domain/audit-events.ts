import type {
  ClaimReason,
  Contract,
  ContractChanges,
  LeftReason,
} from "./contract.js";

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

/** By the owner (empty body), or because they deleted their account. */
export function contractRevoked(reason?: "account_deleted"): AuditEntry {
  return { type: "contract.revoked", body: reason ? { reason } : {} };
}

/** They refused their role (actor: them), or their account is gone (actor: the system). */
export function participantLeft(
  role: "accessor" | "validator",
  reason: LeftReason,
): AuditEntry {
  return { type: "participant.left", body: { role, reason } };
}

export function contractDeleted(
  reason: "owner" | "account_deleted",
): AuditEntry {
  return { type: "contract.deleted", body: { reason } };
}

export type ClosedReason =
  | "cancelled"
  | "withdrawn"
  | "rejected"
  | "expired"
  | "revoked"
  | "participant_left";

export function claimFiled(claim: {
  claimId: string;
  contestUntil: Date;
  reason: ClaimReason;
}): AuditEntry {
  return {
    type: "claim.filed",
    body: {
      claim_id: claim.claimId,
      contest_until: claim.contestUntil.toISOString(),
      reason: claim.reason,
    },
  };
}

/**
 * The wording the owner accepts when they allow a claim saying they can no longer act: the app's
 * seal.incapacity.consent. A new wording is a new version, so that the log says which one was accepted.
 */
export const INCAPACITY_CONSENT_VERSION = 1;

/**
 * The owner's explicit consent to a claim saying they can no longer act (GDPR art. 9: their health), given or
 * withdrawn. Actor: the owner.
 */
export function incapacityConsent(granted: boolean): AuditEntry {
  return {
    type: "consent.incapacity",
    body: granted
      ? { granted: true, version: INCAPACITY_CONSENT_VERSION }
      : { granted: false },
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
  reason: ClosedReason;
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
