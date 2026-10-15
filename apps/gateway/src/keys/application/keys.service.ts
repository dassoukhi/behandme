import { Inject, Injectable } from "@nestjs/common";
import {
  type Clock,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from "@lib/kernel";
import { TrustService } from "../../users/application/trust.service.js";
import {
  assertWellFormed,
  fingerprintInput,
  type KeySubmission,
  type RegisteredKeys,
  registrationStatement,
} from "../domain/keys.js";
import {
  KEY_CRYPTOGRAPHY,
  KEY_REPOSITORY,
  type KeyCryptography,
  type KeyRepository,
} from "./ports.js";

export const KEYS_CLOCK = Symbol("KeysClock");

@Injectable()
export class KeysService {
  constructor(
    @Inject(KEY_REPOSITORY) private readonly keys: KeyRepository,
    @Inject(KEY_CRYPTOGRAPHY) private readonly crypto: KeyCryptography,
    @Inject(KEYS_CLOCK) private readonly clock: Clock,
    private readonly trust: TrustService,
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
    assertWellFormed(submission);
    if (submission.keyVersion !== 1) {
      throw new InvalidInputError("A first registration has key_version 1");
    }
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
    const now = this.clock.now();
    const keys = {
      userId: me,
      ...submission,
      fingerprint: this.crypto.sha256Hex(
        fingerprintInput(submission.kemPublicKey, submission.signingPublicKey),
      ),
      usableFrom: now,
    };
    if (!(await this.keys.insert(keys))) {
      throw new ConflictError("Keys are already registered for this account");
    }
    return { ...keys, createdAt: now };
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
