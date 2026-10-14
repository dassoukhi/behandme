import type {
  AuditEvent,
  ChainVerification,
  ContractChanges,
  ContractRecord,
  NewContract,
} from "@lib/contracts";
import { InvalidInputError, NotFoundError } from "@lib/kernel";
import type { HandoverClient } from "../application/handover-client.js";

type Stored = Omit<ContractRecord, "my_role" | "allowed_actions">;

/**
 * Stand-in for the handover service in gateway specs: the same answers for the same calls (role,
 * 404 for a stranger, owner-only drafts), not its full rules, which apps/handover tests.
 */
export class InMemoryHandover implements HandoverClient {
  contracts: Stored[] = [];
  calls: { method: string; userId: string; args: unknown[] }[] = [];

  async list(userId: string) {
    this.calls.push({ method: "list", userId, args: [] });
    return this.contracts
      .filter((c) => roleOf(c, userId))
      .map((c) => record(c, userId));
  }

  async get(userId: string, id: string) {
    return record(this.visible(userId, id), userId);
  }

  async create(userId: string, contract: NewContract) {
    this.calls.push({ method: "create", userId, args: [contract] });
    if ([contract.accessor_id, ...contract.validator_ids].includes(userId)) {
      throw new InvalidInputError(
        "You cannot be the accessor or a validator of your own contract",
      );
    }
    const stored: Stored = {
      id: `contract-${this.contracts.length + 1}`,
      owner_id: userId,
      category: contract.category,
      description: contract.description ?? null,
      status: "draft",
      version: 1,
      accessor_id: contract.accessor_id,
      validator_ids: contract.validator_ids,
      created_at: "2026-10-14T00:00:00.000Z",
      updated_at: "2026-10-14T00:00:00.000Z",
    };
    this.contracts.push(stored);
    return record(stored, userId);
  }

  async update(userId: string, id: string, changes: ContractChanges) {
    const contract = this.owned(userId, id);
    Object.assign(contract, changes, { version: contract.version + 1 });
    return record(contract, userId);
  }

  async remove(userId: string, id: string) {
    this.owned(userId, id);
    this.contracts = this.contracts.filter((c) => c.id !== id);
  }

  async events(userId: string, id: string): Promise<AuditEvent[]> {
    this.visible(userId, id);
    return [];
  }

  async verify(userId: string, id: string): Promise<ChainVerification> {
    this.visible(userId, id);
    return { ok: true, length: 0, head_hash: null, broken_at: null };
  }

  private visible(userId: string, id: string): Stored {
    const contract = this.contracts.find((c) => c.id === id);
    if (!contract || !roleOf(contract, userId)) {
      throw new NotFoundError("Contract not found");
    }
    return contract;
  }

  private owned(userId: string, id: string): Stored {
    const contract = this.visible(userId, id);
    if (contract.owner_id !== userId)
      throw new NotFoundError("Contract not found");
    return contract;
  }
}

function roleOf(c: Stored, userId: string): ContractRecord["my_role"] | null {
  if (c.owner_id === userId) return "owner";
  if (c.accessor_id === userId) return "accessor";
  if (c.validator_ids.includes(userId)) return "validator";
  return null;
}

function record(c: Stored, userId: string): ContractRecord {
  const role = roleOf(c, userId)!;
  return {
    ...c,
    my_role: role,
    allowed_actions:
      role === "owner" && c.status === "draft" ? ["update", "delete"] : [],
  };
}
