import type {
  AuditEvent,
  ChainVerification,
  ClaimReason,
  ContractChanges,
  ContractRecord,
  DecisionBody,
  NewContract,
  RegisteredKeyRecord,
  ReleasePackage,
  SealedMaterial,
  SealRequestBody,
} from "@lib/contracts";
import { ConflictError, InvalidInputError, NotFoundError } from "@lib/kernel";
import type { HandoverClient } from "../application/handover-client.js";

type Stored = Omit<
  ContractRecord,
  "my_role" | "allowed_actions" | "handover_possible" | "claim_reasons"
>;

/**
 * Stand-in for the handover service in gateway specs: the same answers for the same calls (role,
 * 404 for a stranger or someone who left, owner-only drafts), not its full rules, which apps/handover tests.
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
      sealed_version: 0,
      accessor_id: contract.accessor_id,
      validator_ids: contract.validator_ids,
      created_at: "2026-10-14T00:00:00.000Z",
      updated_at: "2026-10-14T00:00:00.000Z",
      contest_days: contract.contest_days ?? 15,
      incapacity_allowed: contract.incapacity_allowed ?? false,
      open_claim: null,
      sealed_validators: [],
      claim_cooldown_until: null,
      departures: [],
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

  /** Records the keys the gateway passed; checks only who seals (handover's checks are tested there). */
  sealedWith: { sealing: SealRequestBody; keys: RegisteredKeyRecord[] } | null =
    null;

  async seal(
    userId: string,
    id: string,
    sealing: SealRequestBody,
    keys: RegisteredKeyRecord[],
  ) {
    const contract = this.owned(userId, id);
    this.sealedWith = { sealing, keys };
    Object.assign(contract, {
      status: "active",
      sealed_version: contract.sealed_version + 1,
      version: contract.version + 1,
      accessor_id: sealing.accessor_id,
      validator_ids: sealing.validator_ids,
    });
    return record(contract, userId);
  }

  async sealed(userId: string, id: string): Promise<SealedMaterial> {
    const contract = this.visible(userId, id);
    if (contract.sealed_version === 0)
      throw new NotFoundError("This contract is not sealed");
    const index = contract.validator_ids.indexOf(userId) + 1;
    return {
      sealed_version: contract.sealed_version,
      manifest: {
        owner: { user_id: contract.owner_id, key_version: 1 },
        accessor: { user_id: contract.accessor_id, key_version: 1 },
      },
      manifest_signature: "",
      // As handover: a validator gets their own share.
      ...(index > 0 ? { share: { index, key_version: 1, wrap: "" } } : {}),
    };
  }

  async revoke(userId: string, id: string) {
    const contract = this.owned(userId, id);
    contract.status = "revoked";
    return record(contract, userId);
  }

  async fileClaim(userId: string, id: string, reason: ClaimReason) {
    const contract = this.visible(userId, id);
    if (contract.owner_id === userId)
      throw new NotFoundError("Contract not found");
    if (contract.status !== "active")
      throw new ConflictError("Not possible now: claim");
    contract.status = "claimed";
    contract.open_claim = {
      id: `claim-${contract.id}`,
      claimant_id: userId,
      reason,
      status: "open",
      filed_at: "2026-10-16T00:00:00.000Z",
      contest_until: "2026-10-23T00:00:00.000Z",
      expires_at: "2026-12-15T00:00:00.000Z",
      approvals: 0,
      rejections: 0,
      threshold: Math.floor(contract.validator_ids.length / 2) + 1,
      my_decision: null,
    };
    return record(contract, userId);
  }

  async cancelClaim(userId: string, id: string, claimId: string) {
    const contract = this.owned(userId, id);
    this.openClaim(contract, claimId);
    Object.assign(contract, { status: "active", open_claim: null });
    return record(contract, userId);
  }

  async withdrawClaim(userId: string, id: string, claimId: string) {
    const contract = this.visible(userId, id);
    if (this.openClaim(contract, claimId).claimant_id !== userId) {
      throw new ConflictError("Not possible now: withdraw_claim");
    }
    Object.assign(contract, { status: "active", open_claim: null });
    return record(contract, userId);
  }

  /** Records what the gateway passed; the decision rules are tested in apps/handover. */
  decidedWith: {
    decision: DecisionBody;
    accessorKey: RegisteredKeyRecord | null;
  } | null = null;

  async decide(
    userId: string,
    id: string,
    claimId: string,
    decision: DecisionBody,
    accessorKey: RegisteredKeyRecord | null,
  ) {
    const contract = this.visible(userId, id);
    if (!contract.validator_ids.includes(userId)) {
      throw new NotFoundError("Contract not found");
    }
    const claim = this.openClaim(contract, claimId);
    this.decidedWith = { decision, accessorKey };
    if (decision.approve) claim.approvals += 1;
    else claim.rejections += 1;
    return record(contract, userId);
  }

  async leave(userId: string, id: string) {
    this.calls.push({ method: "leave", userId, args: [id] });
    const contract = this.visible(userId, id);
    if (contract.owner_id === userId)
      throw new NotFoundError("Contract not found");
    if (contract.status === "released" || contract.status === "revoked")
      throw new ConflictError("Not possible now: leave");
    contract.departures.push({
      user_id: userId,
      role: contract.accessor_id === userId ? "accessor" : "validator",
      reason: "declined",
      left_at: "2026-10-20T00:00:00.000Z",
    });
    for (const sealed of contract.sealed_validators) {
      if (sealed.user_id === userId) sealed.left = true;
    }
  }

  async release(userId: string, id: string): Promise<ReleasePackage> {
    const contract = this.visible(userId, id);
    if (contract.accessor_id !== userId)
      throw new NotFoundError("Contract not found");
    if (contract.status !== "released")
      throw new ConflictError("Not possible now: open");
    return {
      sealed_version: contract.sealed_version,
      manifest: { owner: { user_id: contract.owner_id, key_version: 1 } },
      manifest_signature: "",
      envelope: "",
      claim_id: `claim-${contract.id}`,
      shares: [],
    };
  }

  private openClaim(contract: Stored, claimId: string) {
    if (!contract.open_claim || contract.open_claim.id !== claimId) {
      throw new ConflictError("This claim is no longer open");
    }
    return contract.open_claim;
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
  if (c.departures.some((d) => d.user_id === userId)) return null;
  if (c.accessor_id === userId) return "accessor";
  if (c.validator_ids.includes(userId)) return "validator";
  return null;
}

function record(c: Stored, userId: string): ContractRecord {
  const role = roleOf(c, userId)!;
  const actions: Record<string, ContractRecord["allowed_actions"]> = {
    "owner:draft": ["update", "delete", "seal"],
    "owner:claimed": ["cancel_claim"],
    "accessor:draft": ["leave"],
    "validator:draft": ["leave"],
    "accessor:active": ["claim", "leave"],
    "validator:active": ["claim", "leave"],
    "accessor:claimed": ["leave"],
    "validator:claimed": ["decide", "leave"],
    "accessor:released": ["open"],
  };
  return {
    ...c,
    my_role: role,
    allowed_actions: actions[`${role}:${c.status}`] ?? [],
    // As handover: only the owner is given who left.
    departures: role === "owner" ? c.departures : [],
    handover_possible: !c.departures.some((d) => d.user_id === c.accessor_id),
    claim_reasons:
      c.incapacity_allowed && c.category !== "finances"
        ? ["death", "incapacity"]
        : ["death"],
  };
}
