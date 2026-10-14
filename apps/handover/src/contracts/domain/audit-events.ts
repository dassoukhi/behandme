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

export function contractDeleted(
  reason: "owner" | "account_deleted",
): AuditEntry {
  return { type: "contract.deleted", body: { reason } };
}
