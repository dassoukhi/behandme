import { Inject, Injectable } from "@nestjs/common";
import { KeysRotated } from "@lib/contracts";
import {
  type Clock,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from "@lib/kernel";
import { TrustService } from "../../users/application/trust.service.js";
import {
  assertWellFormed,
  type FactorVerificationAge,
  fingerprintInput,
  type KeySubmission,
  type RegisteredKeys,
  recentlyVerified,
  registrationStatement,
  ReverificationRequired,
} from "../domain/keys.js";
import {
  KEY_CRYPTOGRAPHY,
  KEY_HOLDER_DIRECTORY,
  KEY_QUARANTINE,
  KEY_REPOSITORY,
  KEYS_UNIT_OF_WORK,
  type KeyCryptography,
  type KeyHolderDirectory,
  type KeyRepository,
  type KeysUnitOfWork,
} from "./ports.js";

export const KEYS_CLOCK = Symbol("KeysClock");

@Injectable()
export class KeysService {
  constructor(
    @Inject(KEY_REPOSITORY) private readonly keys: KeyRepository,
    @Inject(KEY_CRYPTOGRAPHY) private readonly crypto: KeyCryptography,
    @Inject(KEYS_CLOCK) private readonly clock: Clock,
    private readonly trust: TrustService,
    @Inject(KEYS_UNIT_OF_WORK) private readonly unitOfWork: KeysUnitOfWork,
    @Inject(KEY_HOLDER_DIRECTORY) private readonly holders: KeyHolderDirectory,
    @Inject(KEY_QUARANTINE) private readonly quarantineMs: number,
  ) {}

  async mine(me: string): Promise<RegisteredKeys> {
    const keys = await this.keys.find(me);
    if (!keys) throw new NotFoundError("No keys registered yet");
    return keys;
  }

  /**
   * First registration (version 1): usable at once. The signature proves the holder of the private
   * signing key chose these keys for this account; a reset of lost keys is a separate, guarded action.
   */
  async register(
    me: string,
    submission: KeySubmission,
  ): Promise<RegisteredKeys> {
    if (submission.keyVersion !== 1) {
      throw new InvalidInputError("A first registration has key_version 1");
    }
    const now = this.clock.now();
    const keys = { ...this.signedKeys(me, submission), usableFrom: now };
    if (!(await this.keys.insert(keys))) {
      throw new ConflictError("Keys are already registered for this account");
    }
    return { ...keys, createdAt: now };
  }

  /**
   * Replaces lost or compromised keys by new ones, signed by them, with the next key version. Needs a
   * session verified again a moment ago (`fva`): a stolen session alone cannot do it. Others may use
   * the new keys only after the quarantine; the user and the people who trust them are told at once.
   */
  async reset(
    me: string,
    submission: KeySubmission,
    fva: FactorVerificationAge | null,
  ): Promise<RegisteredKeys> {
    if (!recentlyVerified(fva)) throw new ReverificationRequired();
    const signed = this.signedKeys(me, submission);
    const holder = await this.holders.describe(me);
    return this.unitOfWork.run(async ({ keys, events }) => {
      const current = await keys.find(me);
      if (!current) {
        throw new NotFoundError("No keys to reset: register them instead");
      }
      if (submission.keyVersion !== current.keyVersion + 1) {
        throw new ConflictError(
          `New keys must have key_version ${current.keyVersion + 1}`,
        );
      }
      if (signed.fingerprint === current.fingerprint) {
        throw new InvalidInputError("These are already the account's keys");
      }
      const now = this.clock.now();
      const next = {
        ...signed,
        usableFrom: new Date(now.getTime() + this.quarantineMs),
        createdAt: now,
      };
      if (!(await keys.replace(current.keyVersion, next, "reset"))) {
        throw new ConflictError("The keys changed meanwhile: try again");
      }
      await events.publish(
        KeysRotated.create({
          userId: me,
          keyVersion: next.keyVersion,
          usableFrom: next.usableFrom.toISOString(),
          userName: holder.name,
          trusterIds: holder.trusterIds,
        }),
      );
      return next;
    });
  }

  /** Well-formed keys that `me` signed for this account and version, with their fingerprint. */
  private signedKeys(me: string, submission: KeySubmission) {
    assertWellFormed(submission);
    const statement = this.crypto.canonicalJson(
      registrationStatement(
        me,
        submission.keyVersion,
        this.crypto.toBase64(submission.kemPublicKey),
        this.crypto.toBase64(submission.signingPublicKey),
      ),
    );
    if (
      !this.crypto.verifyEd25519(
        submission.signingPublicKey,
        statement,
        submission.signature,
      )
    ) {
      throw new InvalidInputError("The registration signature does not verify");
    }
    return {
      userId: me,
      ...submission,
      fingerprint: this.crypto.sha256Hex(
        fingerprintInput(submission.kemPublicKey, submission.signingPublicKey),
      ),
    };
  }

  /**
   * Public keys of the users among `ids` that `me` may encrypt to or check: themselves, the users they
   * trust and those who trust them. Users without keys are left out.
   */
  async visible(me: string, ids: string[]): Promise<RegisteredKeys[]> {
    const unique = [...new Set(ids)].slice(0, 50);
    const others = unique.filter((id) => id !== me);
    const [trusted, trusting] = await Promise.all([
      this.trust.trustedAmong(me, others),
      this.trust.whoTrusts(me, others),
    ]);
    const allowed = unique.filter(
      (id) => id === me || trusted.has(id) || trusting.has(id),
    );
    return this.keys.findMany(allowed);
  }
}
