import { Inject, Injectable } from "@nestjs/common";
import type {
  AuditEvent,
  ChainVerification,
  ContractChanges,
  ContractRecord,
  NewContract,
  SealedMaterial,
  SealRequestBody,
} from "@lib/contracts";
import { InvalidInputError } from "@lib/kernel";
import {
  HANDOVER_CLIENT,
  type HandoverClient,
} from "../../handover/application/handover-client.js";
import { KeysService } from "../../keys/application/keys.service.js";
import type { Profile } from "../../users/domain/profile.js";
import { ProfileService } from "../../users/application/profile.service.js";
import { TrustService } from "../../users/application/trust.service.js";

/** A contract with its participants' profiles, as the caller may see them. */
export type ContractView = ContractRecord & {
  owner: Profile | null;
  accessor: Profile | null;
};
export type ContractDetail = ContractView & { validators_list: Profile[] };

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
    const profiles = await this.profiles.visibleProfiles(
      me,
      records.flatMap((r) => [r.owner_id, r.accessor_id]),
    );
    return records.map((record) => view(record, profiles));
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
    const records = keys.map((k) => ({
      user_id: k.userId,
      key_version: k.keyVersion,
      fingerprint: k.fingerprint,
      signing_public_key: Buffer.from(k.signingPublicKey).toString("base64"),
      usable_from: k.usableFrom.toISOString(),
    }));
    return this.detail(me, await this.handover.seal(me, id, sealing, records));
  }

  sealed(me: string, id: string): Promise<SealedMaterial> {
    return this.handover.sealed(me, id);
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
    const profiles = await this.profiles.visibleProfiles(me, [
      record.owner_id,
      record.accessor_id,
      ...record.validator_ids,
    ]);
    return {
      ...view(record, profiles),
      validators_list: record.validator_ids
        .map((id) => profiles.get(id))
        .filter((p): p is Profile => p !== undefined),
    };
  }
}

function view(
  record: ContractRecord,
  profiles: Map<string, Profile>,
): ContractView {
  return {
    ...record,
    owner: profiles.get(record.owner_id) ?? null,
    accessor: profiles.get(record.accessor_id) ?? null,
  };
}
