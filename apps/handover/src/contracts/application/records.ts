import type { ClaimRecord, ContractRecord, SealedKey } from "@lib/contracts";
import {
  canBeHandedOver,
  type Claim,
  cooldownUntil,
  type Decision,
  tallyFor,
} from "../domain/claims.js";
import {
  claimContestDays,
  claimReasons,
  type Contract,
  hasLeft,
  type Role,
  roleOf,
} from "../domain/contract.js";
import { allowedActions } from "../domain/lifecycle.js";
import type { HandoverStore } from "./ports.js";

/** Everything a contract record shows beyond the contract itself; loaded in batches by `recordsFor`. */
export interface RecordExtras {
  me: string;
  claim: Claim | null;
  decisions: Decision[];
  cooldownUntil: Date | null;
  /** Canonical JSON of the signed manifest, when sealed. */
  manifest: string | null;
}

/** The contracts as `me` sees them, with their open claims, in a few queries. */
export async function recordsFor(
  store: HandoverStore,
  me: string,
  contracts: Contract[],
  now: Date,
): Promise<ContractRecord[]> {
  const ids = contracts.map((c) => c.id);
  const [open, lastClosed, manifests] = await Promise.all([
    store.claims.openFor(ids),
    store.claims.lastClosedBy(me, ids),
    store.sealings.manifests(ids),
  ]);
  const decisions = await store.claims.decisions(open.map((c) => c.id));
  return contracts.map((contract) => {
    const claim = open.find((c) => c.contractId === contract.id) ?? null;
    return toRecord(contract, roleOf(contract, me)!, {
      me,
      claim,
      decisions: claim ? (decisions.get(claim.id) ?? []) : [],
      cooldownUntil: cooldownUntil(
        lastClosed.find((c) => c.contractId === contract.id) ?? null,
        contract.ownerId,
        now,
      ),
      manifest: manifests.get(contract.id) ?? null,
    });
  });
}

export function toRecord(
  contract: Contract,
  role: Role,
  extras: RecordExtras,
): ContractRecord {
  const { me, claim, decisions } = extras;
  const mine = decisions.find((d) => d.validatorId === me);
  return {
    id: contract.id,
    owner_id: contract.ownerId,
    category: contract.category,
    description: contract.description,
    status: contract.status,
    version: contract.version,
    sealed_version: contract.sealedVersion,
    accessor_id: contract.accessorId,
    validator_ids: contract.validatorIds,
    created_at: contract.createdAt,
    updated_at: contract.updatedAt,
    my_role: role,
    allowed_actions: allowedActions(contract, role, {
      me,
      claim: claim
        ? { claimantId: claim.claimantId, decidedByMe: mine !== undefined }
        : null,
      cooldownUntil: extras.cooldownUntil,
    }),
    contest_days: contract.contestDays,
    open_claim: claim ? claimRecord(claim, decisions, contract, me) : null,
    sealed_validators: sealedValidators(contract, extras.manifest),
    claim_cooldown_until: extras.cooldownUntil?.toISOString() ?? null,
    // For the owner, who chooses someone else (the log, which every participant reads, records departures too).
    departures:
      role === "owner"
        ? contract.departures.map((d) => ({
            user_id: d.userId,
            role: d.role,
            reason: d.reason,
            left_at: d.at,
          }))
        : [],
    handover_possible: canBeHandedOver(contract),
    incapacity_allowed: contract.incapacityAllowed,
    claim_reasons: claimReasons(contract),
    claim_contest_days: {
      death: claimContestDays(contract, "death"),
      incapacity: claimContestDays(contract, "incapacity"),
    },
  };
}

function claimRecord(
  claim: Claim,
  decisions: Decision[],
  contract: Contract,
  me: string,
): ClaimRecord {
  const result = tallyFor(contract, decisions);
  const mine = decisions.find((d) => d.validatorId === me);
  return {
    id: claim.id,
    claimant_id: claim.claimantId,
    reason: claim.reason,
    statement: claim.statement,
    status: claim.status,
    filed_at: claim.filedAt.toISOString(),
    contest_until: claim.contestUntil.toISOString(),
    expires_at: claim.expiresAt.toISOString(),
    approvals: result.approvals,
    rejections: result.rejections,
    threshold: result.threshold,
    my_decision: mine ? (mine.approve ? "approve" : "reject") : null,
  };
}

/** The validators' keys named in the signed manifest, and whether they left. */
function sealedValidators(
  contract: Contract,
  manifest: string | null,
): SealedKey[] {
  if (!manifest) return [];
  const parsed = JSON.parse(manifest) as {
    validators: Omit<SealedKey, "left">[];
  };
  return parsed.validators.map((v) => ({
    user_id: v.user_id,
    key_version: v.key_version,
    fingerprint: v.fingerprint,
    left: hasLeft(contract, v.user_id),
  }));
}
