import { ConflictError, NotFoundError } from "@lib/kernel";
import type { Contract, Role, Status } from "./contract.js";

// Who may do what, in which status. Handover is the only authority on a contract's life cycle; the
// gateway and the app read `allowedActions` instead of repeating these rules. Sealing (phase 4),
// claims and release (phase 5) add their actions here.

export type Action = "update" | "delete" | "seal" | "revoke";

const RULES: Record<Action, { roles: Role[]; statuses: Status[] }> = {
  // Category and description; participants change by re-sealing (phase 4).
  update: { roles: ["owner"], statuses: ["draft", "active"] },
  // Only a draft, which holds nothing yet; a sealed contract is revoked instead.
  delete: { roles: ["owner"], statuses: ["draft"] },
  // First sealing, or a new one (new secret, new participants, new keys): never during a claim.
  seal: { roles: ["owner"], statuses: ["draft", "active"] },
  // Until release: the sealed material is deleted, and nobody can ever open it.
  revoke: { roles: ["owner"], statuses: ["active", "claimed"] },
};

export function allowedActions(contract: Contract, role: Role): Action[] {
  return (Object.keys(RULES) as Action[]).filter(
    (action) =>
      RULES[action].roles.includes(role) &&
      RULES[action].statuses.includes(contract.status),
  );
}

/**
 * Refuses an action: as "not found" to someone whose role never allows it (as for a stranger, the
 * request reveals nothing), as a conflict when only the status is wrong.
 */
export function assertAllowed(
  action: Action,
  contract: Contract,
  role: Role,
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
}
