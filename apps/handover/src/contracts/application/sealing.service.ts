import { Inject, Injectable } from "@nestjs/common";
import {
  ClaimClosed,
  type ContractRecord,
  type SealedMaterial,
} from "@lib/contracts";
import { type Clock, ConflictError, NotFoundError } from "@lib/kernel";
import {
  claimClosed,
  contractRevoked,
  contractSealed,
} from "../domain/audit-events.js";
import { type Contract, type Role, roleOf } from "../domain/contract.js";
import { assertAllowed } from "../domain/lifecycle.js";
import {
  checkSeal,
  type RegisteredKey,
  type SealRequest,
} from "../domain/sealing.js";
import { recordsFor } from "./records.js";
import {
  CLOCK,
  HANDOVER_STORES,
  type HandoverStore,
  type HandoverStores,
  SEAL_CRYPTO,
  type SealCrypto,
} from "./ports.js";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * Sealed contracts: storing what the owner's phone sealed (after checking it), handing each participant
 * only what their role may have, and revoking. The server never holds anything that opens a secret.
 */
@Injectable()
export class SealingService {
  constructor(
    @Inject(HANDOVER_STORES) private readonly stores: HandoverStores,
    @Inject(SEAL_CRYPTO) private readonly crypto: SealCrypto,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `keys`: the current public keys of the owner and of every participant named in the request, given
   * by the gateway (which owns them).
   */
  async seal(
    me: string,
    id: string,
    request: SealRequest,
    keys: ReadonlyMap<string, RegisteredKey>,
  ): Promise<ContractRecord> {
    return this.stores.transaction(async (store) => {
      const { contract, role } = await visible(store, me, id);
      assertAllowed("seal", contract, role);
      const { manifest, manifestText } = checkSeal(
        contract,
        request,
        keys,
        this.crypto,
        this.clock.now(),
      );
      const sealing = {
        sealedVersion: manifest.version,
        envelope: request.envelope,
        envelopeHash: manifest.envelope_hash,
        manifestText,
        manifestSignature: request.manifestSignature,
        ownerWrap: request.ownerWrap,
        ownerKeyVersion: manifest.owner.key_version,
        shares: request.shares,
      };
      const updated = await store.contracts.markSealed(
        id,
        {
          sealedVersion: sealing.sealedVersion,
          accessorId: request.accessorId,
          validatorIds: request.validatorIds,
        },
        request.expectedVersion,
      );
      if (!updated)
        throw new ConflictError(
          "The contract changed meanwhile: reload it and seal again",
        );
      await store.sealings.replace(id, sealing);
      await store.audit.append(
        id,
        me,
        contractSealed({
          sealedVersion: sealing.sealedVersion,
          envelopeHash: sealing.envelopeHash,
          threshold: manifest.threshold,
          accessorId: request.accessorId,
          validatorIds: request.validatorIds,
        }),
      );
      return (await recordsFor(store, me, [updated], this.clock.now()))[0];
    });
  }

  /**
   * The owner gets the envelope and their copy of the key; a validator their share; the accessor only
   * the manifest until release (phase 5). Everyone gets the signed manifest, to check it.
   */
  async material(me: string, id: string): Promise<SealedMaterial> {
    const { contract, role } = await visible(this.stores.root, me, id);
    const sealing = await this.stores.root.sealings.find(id);
    if (!sealing || contract.status === "revoked") {
      throw new NotFoundError("This contract is not sealed");
    }
    const material: SealedMaterial = {
      sealed_version: sealing.sealedVersion,
      manifest: JSON.parse(sealing.manifestText) as Record<string, unknown>,
      manifest_signature: b64(sealing.manifestSignature),
    };
    if (role === "owner") {
      material.envelope = b64(sealing.envelope);
      material.owner_wrap = b64(sealing.ownerWrap);
    }
    if (role === "validator") {
      const share = sealing.shares.find((s) => s.userId === me)!;
      material.share = {
        index: share.index,
        key_version: share.keyVersion,
        wrap: b64(share.wrap),
      };
    }
    return material;
  }

  /** Deletes every ciphertext: from now on nobody, the accessor included, can open the secret. */
  async revoke(
    me: string,
    id: string,
    expectedVersion: number,
  ): Promise<ContractRecord> {
    return this.stores.transaction(async (store) => {
      const { contract, role } = await visible(store, me, id);
      assertAllowed("revoke", contract, role);
      const updated = await store.contracts.markRevoked(id, expectedVersion);
      if (!updated)
        throw new ConflictError(
          "The contract changed meanwhile: reload it and try again",
        );
      await store.sealings.delete(id);
      // A claim in progress ends with the contract: its re-wrapped shares go too.
      const [claim] = await store.claims.openFor([id]);
      if (claim) {
        await store.claims.close(claim.id, "cancelled", me, this.clock.now());
        await store.claims.eraseReleaseWraps(claim.id);
        await store.audit.append(
          id,
          me,
          claimClosed({ claimId: claim.id, reason: "revoked" }),
        );
        await store.events.publish(
          ClaimClosed.create({
            contractId: id,
            claimId: claim.id,
            category: contract.category,
            reason: "revoked",
            closedBy: me,
            ownerId: contract.ownerId,
            claimantId: claim.claimantId,
            validatorIds: contract.validatorIds,
          }),
        );
      }
      await store.audit.append(id, me, contractRevoked());
      return (await recordsFor(store, me, [updated], this.clock.now()))[0];
    });
  }
}

async function visible(
  store: HandoverStore,
  me: string,
  id: string,
): Promise<{ contract: Contract; role: Role }> {
  const contract = await store.contracts.find(id);
  const role = contract ? roleOf(contract, me) : null;
  if (!contract || !role) throw new NotFoundError("Contract not found");
  return { contract, role };
}
