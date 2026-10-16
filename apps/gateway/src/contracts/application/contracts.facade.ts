import { Inject, Injectable } from "@nestjs/common";
import type {
  AuditEvent,
  ChainVerification,
  ContractChanges,
  ContractRecord,
  DecisionBody,
  NewContract,
  RegisteredKeyRecord,
  ReleasePackage,
  SealedMaterial,
  SealRequestBody,
} from "@lib/contracts";
import { InvalidInputError } from "@lib/kernel";
import {
  HANDOVER_CLIENT,
  type HandoverClient,
} from "../../handover/application/handover-client.js";
import { KeysService } from "../../keys/application/keys.service.js";
import {
  type PublicKeys,
  toPublicKeys,
} from "../../keys/application/public-keys.js";
import type { RegisteredKeys } from "../../keys/domain/keys.js";
import type { Profile } from "../../users/domain/profile.js";
import { ProfileService } from "../../users/application/profile.service.js";
import { TrustService } from "../../users/application/trust.service.js";

/** How many validators could still approve a claim: their keys are those the contract was sealed for. */
export interface Health {
  usable: number;
  total: number;
  threshold: number;
}

/** A contract with its participants' profiles, as the caller may see them. */
export type ContractView = Omit<ContractRecord, "sealed_validators"> & {
  owner: Profile | null;
  accessor: Profile | null;
  /** Null while never sealed. */
  health: Health | null;
};
export type ContractDetail = ContractView & { validators_list: Profile[] };

/** Sealed material, with the keys the caller's phone needs to check and use it. */
export type SealedMaterialView = SealedMaterial & {
  /** The owner's keys that signed the manifest (current or retired). */
  owner_keys: PublicKeys | null;
  /** Validator only: the accessor's current keys, to re-wrap a share for them. */
  accessor_keys?: PublicKeys | null;
};

export type ReleasePackageView = ReleasePackage & {
  owner_keys: PublicKeys | null;
};

/**
 * The app's contract routes. Handover owns contracts and their rules; the gateway adds what it owns:
 * the participants must be people the caller trusts, and profiles follow the visibility rule.
 */
@Injectable()
export class ContractsFacade {
  constructor(
    @Inject(HANDOVER_CLIENT) private readonly handover: HandoverClient,
    private readonly profiles: ProfileService,
    private readonly trust: TrustService,
    private readonly keys: KeysService,
  ) {}

  async list(me: string): Promise<ContractView[]> {
    const records = await this.handover.list(me);
    const [profiles, health] = await Promise.all([
      this.profiles.visibleProfiles(
        me,
        records.flatMap((r) => [r.owner_id, r.accessor_id]),
      ),
      this.health(records),
    ]);
    return records.map((record) => view(record, profiles, health));
  }

  async get(me: string, id: string): Promise<ContractDetail> {
    return this.detail(me, await this.handover.get(me, id));
  }

  async create(me: string, contract: NewContract): Promise<ContractDetail> {
    await this.assertTrusted(me, [
      contract.accessor_id,
      ...contract.validator_ids,
    ]);
    return this.detail(me, await this.handover.create(me, contract));
  }

  /**
   * Seals (or re-seals) on the owner's behalf: the participants must still be people they trust, and
   * handover receives everyone's current registered keys to check the signed manifest against them.
   */
  async seal(
    me: string,
    id: string,
    sealing: SealRequestBody,
  ): Promise<ContractDetail> {
    const participants = [sealing.accessor_id, ...sealing.validator_ids];
    await this.assertTrusted(me, participants);
    const keys = await this.keys.visible(me, [me, ...participants]);
    const missing = [me, ...participants].filter(
      (id) => !keys.some((k) => k.userId === id),
    );
    if (missing.length) {
      throw new InvalidInputError(
        `Everyone must have activated their keys first (missing: ${missing.join(", ")})`,
      );
    }
    return this.detail(
      me,
      await this.handover.seal(me, id, sealing, keys.map(registeredKeyRecord)),
    );
  }

  /** Handover hands out what the caller's role may have; the gateway adds the keys to check it with. */
  async sealed(me: string, id: string): Promise<SealedMaterialView> {
    const material = await this.handover.sealed(me, id);
    const manifest = material.manifest as {
      owner?: { user_id: string; key_version: number };
      accessor?: { user_id: string };
    };
    const ownerKeys = await this.ownerKeys(manifest);
    if (!material.share || !manifest.accessor) {
      return { ...material, owner_keys: ownerKeys };
    }
    const [accessor] = await this.keys.participants([
      manifest.accessor.user_id,
    ]);
    return {
      ...material,
      owner_keys: ownerKeys,
      accessor_keys: accessor ? toPublicKeys(accessor) : null,
    };
  }

  /** The accessor or a validator asks for the release. */
  async fileClaim(me: string, id: string): Promise<ContractDetail> {
    return this.detail(me, await this.handover.fileClaim(me, id));
  }

  /** "I'm here": the owner stops the claim. */
  async cancelClaim(
    me: string,
    id: string,
    claimId: string,
  ): Promise<ContractDetail> {
    return this.detail(me, await this.handover.cancelClaim(me, id, claimId));
  }

  async withdrawClaim(
    me: string,
    id: string,
    claimId: string,
  ): Promise<ContractDetail> {
    return this.detail(me, await this.handover.withdrawClaim(me, id, claimId));
  }

  /**
   * A validator's decision. An approval was wrapped to the accessor's keys: handover checks it against
   * their current registered keys, which the gateway owns.
   */
  async decide(
    me: string,
    id: string,
    claimId: string,
    decision: DecisionBody,
  ): Promise<ContractDetail> {
    let accessorKey: RegisteredKeyRecord | null = null;
    if (decision.approve) {
      const contract = await this.handover.get(me, id);
      const [keys] = await this.keys.participants([contract.accessor_id]);
      accessorKey = keys ? registeredKeyRecord(keys) : null;
    }
    return this.detail(
      me,
      await this.handover.decide(me, id, claimId, decision, accessorKey),
    );
  }

  /** The accessor's download once released, with the owner's keys to check the manifest. */
  async release(me: string, id: string): Promise<ReleasePackageView> {
    const pack = await this.handover.release(me, id);
    return {
      ...pack,
      owner_keys: await this.ownerKeys(
        pack.manifest as { owner?: { user_id: string; key_version: number } },
      ),
    };
  }

  private async ownerKeys(manifest: {
    owner?: { user_id: string; key_version: number };
  }): Promise<PublicKeys | null> {
    if (!manifest.owner) return null;
    const keys = await this.keys.atVersion(
      manifest.owner.user_id,
      manifest.owner.key_version,
    );
    return keys ? toPublicKeys(keys) : null;
  }

  /** For each sealed contract, the validators whose current keys are still those it was sealed for. */
  private async health(
    records: ContractRecord[],
  ): Promise<Map<string, Health>> {
    const current = new Map(
      (
        await this.keys.participants(
          records.flatMap((r) => r.sealed_validators.map((v) => v.user_id)),
        )
      ).map((k) => [k.userId, k]),
    );
    return new Map(
      records
        .filter((r) => r.sealed_validators.length > 0)
        .map((r) => [
          r.id,
          {
            usable: r.sealed_validators.filter(
              (v) => current.get(v.user_id)?.fingerprint === v.fingerprint,
            ).length,
            total: r.sealed_validators.length,
            threshold: Math.floor(r.sealed_validators.length / 2) + 1,
          },
        ]),
    );
  }

  async revoke(
    me: string,
    id: string,
    expectedVersion: number,
  ): Promise<ContractDetail> {
    return this.detail(me, await this.handover.revoke(me, id, expectedVersion));
  }

  /** Handover refuses the caller as a participant; trust is checked on the others. */
  private async assertTrusted(
    me: string,
    participants: string[],
  ): Promise<void> {
    const others = participants.filter((id) => id !== me);
    const trusted = await this.trust.trustedAmong(me, others);
    if (others.some((id) => !trusted.has(id))) {
      throw new InvalidInputError(
        "Accessor and validators must be people you trust",
      );
    }
  }

  async update(
    me: string,
    id: string,
    changes: ContractChanges,
  ): Promise<ContractDetail> {
    return this.detail(me, await this.handover.update(me, id, changes));
  }

  remove(me: string, id: string): Promise<void> {
    return this.handover.remove(me, id);
  }

  events(me: string, id: string): Promise<AuditEvent[]> {
    return this.handover.events(me, id);
  }

  verify(me: string, id: string): Promise<ChainVerification> {
    return this.handover.verify(me, id);
  }

  private async detail(
    me: string,
    record: ContractRecord,
  ): Promise<ContractDetail> {
    const [profiles, health] = await Promise.all([
      this.profiles.visibleProfiles(me, [
        record.owner_id,
        record.accessor_id,
        ...record.validator_ids,
      ]),
      this.health([record]),
    ]);
    return {
      ...view(record, profiles, health),
      validators_list: record.validator_ids
        .map((id) => profiles.get(id))
        .filter((p): p is Profile => p !== undefined),
    };
  }
}

function view(
  record: ContractRecord,
  profiles: Map<string, Profile>,
  health: Map<string, Health>,
): ContractView {
  // The sealed keys only serve to compute health: the app gets the result.
  const visible: Omit<ContractRecord, "sealed_validators"> & {
    sealed_validators?: unknown;
  } = { ...record };
  delete visible.sealed_validators;
  return {
    ...visible,
    owner: profiles.get(record.owner_id) ?? null,
    accessor: profiles.get(record.accessor_id) ?? null,
    health: health.get(record.id) ?? null,
  };
}

/** A user's current keys as handover checks them. */
function registeredKeyRecord(keys: RegisteredKeys): RegisteredKeyRecord {
  return {
    user_id: keys.userId,
    key_version: keys.keyVersion,
    fingerprint: keys.fingerprint,
    signing_public_key: Buffer.from(keys.signingPublicKey).toString("base64"),
    usable_from: keys.usableFrom.toISOString(),
  };
}
