import { ConflictError, NotFoundError } from "@lib/kernel";
import { canBeHandedOver } from "./claims.js";
import {
  type Contract,
  INCAPACITY,
  presentParticipants,
  type Role,
  type Status,
} from "./contract.js";

// Who may do what, in which status. Handover is the only authority on a contract's life cycle; the
// gateway and the app read `allowedActions` instead of repeating these rules.

export type Action =
  | "update"
  | "delete"
  | "seal"
  | "revoke"
  | "claim"
  | "cancel_claim"
  | "withdraw_claim"
  | "decide"
  | "open"
  | "leave"
  | "grant_consent"
  | "withdraw_consent";

/** What the rules need beyond the contract and the role: the caller and the open claim. */
export interface ActionContext {
  me: string;
  claim: { claimantId: string; decidedByMe: boolean } | null;
  /** The caller may not claim again before then (the owner cancelled their last claim). */
  cooldownUntil: Date | null;
}

const NO_CONTEXT: ActionContext = { me: "", claim: null, cooldownUntil: null };

const RULES: Record<
  Action,
  {
    roles: Role[];
    statuses: Status[];
    when?: (c: ActionContext, contract: Contract) => boolean;
  }
> = {
  // Category, description, contest window; participants change by re-sealing.
  update: { roles: ["owner"], statuses: ["draft", "active"] },
  // Only a draft, which holds nothing yet; a sealed contract is revoked instead.
  delete: { roles: ["owner"], statuses: ["draft"] },
  // First sealing, or a new one (new secret, new participants, new keys): never during a claim.
  seal: { roles: ["owner"], statuses: ["draft", "active"] },
  // Until release: the sealed material is deleted, and nobody can ever open it.
  revoke: { roles: ["owner"], statuses: ["active", "claimed"] },
  // The owner can no longer act: one open claim at a time, a pause after the owner cancelled one, and none
  // that could not succeed (the accessor left, or too few validators remain).
  claim: {
    roles: ["accessor", "validator"],
    statuses: ["active"],
    when: (c, contract) =>
      c.cooldownUntil === null && canBeHandedOver(contract),
  },
  // "I'm here": the owner stops the claim during the contest window, or any time before release.
  cancel_claim: { roles: ["owner"], statuses: ["claimed"] },
  withdraw_claim: {
    roles: ["accessor", "validator"],
    statuses: ["claimed"],
    when: (c) => c.claim?.claimantId === c.me,
  },
  // Each validator decides once: approving re-wraps their share to the accessor.
  decide: {
    roles: ["validator"],
    statuses: ["claimed"],
    when: (c) => c.claim !== null && !c.claim.decidedByMe,
  },
  open: { roles: ["accessor"], statuses: ["released"] },
  // A participant refuses their role, at any time before the end: they no longer see the contract
  // (application/endings.ts, leaveContract).
  leave: {
    roles: ["accessor", "validator"],
    statuses: ["draft", "active", "claimed"],
  },
  // The owner consents to a claim for an incapacity: never for finances, and with at least 2 validators once sealed (a
  // draft's validators are provisional, its sealing checks them).
  grant_consent: {
    roles: ["owner"],
    statuses: ["draft", "active"],
    when: (_c, contract) =>
      !contract.incapacityAllowed &&
      contract.category !== "finances" &&
      (contract.status === "draft" ||
        presentParticipants(contract).validatorIds.length >=
          INCAPACITY.minValidators),
  },
  // The owner withdraws their consent to a claim for an incapacity at any time before the end (GDPR art. 7.3), even
  // during a claim: one that gave this reason closes (ContractsService.update).
  withdraw_consent: {
    roles: ["owner"],
    statuses: ["draft", "active", "claimed"],
    when: (_c, contract) => contract.incapacityAllowed,
  },
};

export function allowedActions(
  contract: Contract,
  role: Role,
  context: ActionContext = NO_CONTEXT,
): Action[] {
  return (Object.keys(RULES) as Action[]).filter(
    (action) =>
      RULES[action].roles.includes(role) &&
      RULES[action].statuses.includes(contract.status) &&
      (RULES[action].when?.(context, contract) ?? true),
  );
}

/**
 * Refuses an action: as "not found" to someone whose role never allows it (as for a stranger, the
 * request reveals nothing), as a conflict when only the status or the moment is wrong.
 */
export function assertAllowed(
  action: Action,
  contract: Contract,
  role: Role,
  context: ActionContext = NO_CONTEXT,
): void {
  const rule = RULES[action];
  if (!rule.roles.includes(role)) {
    throw new NotFoundError("Contract not found");
  }
  if (!rule.statuses.includes(contract.status)) {
    throw new ConflictError(
      `Not possible on a ${contract.status} contract: ${action}`,
    );
  }
  if (rule.when && !rule.when(context, contract)) {
    throw new ConflictError(`Not possible now: ${action}`);
  }
}
