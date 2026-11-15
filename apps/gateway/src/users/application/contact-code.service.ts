import { Inject, Injectable } from "@nestjs/common";
import {
  type Clock,
  isSecretToken,
  newSecretToken,
  secretTokenHash,
} from "@lib/kernel";
import {
  CONTACT_CODE_TTL_MS,
  type ContactCode,
  isValid,
} from "../domain/contact-code.js";
import {
  CONTACT_CODE_REPOSITORY,
  USERS_CLOCK,
  type ContactCodeRepository,
} from "./ports.js";

/**
 * Contact codes (the app's docs/crypto-protocol.md, "Contact code"): one per user, for ten minutes. Whoever holds
 * one may read its owner's profile and keys (keys/application/scanned-contact.service.ts) and add them
 * (TrustService.add): showing the code is agreeing to both.
 */
@Injectable()
export class ContactCodeService {
  constructor(
    @Inject(CONTACT_CODE_REPOSITORY)
    private readonly codes: ContactCodeRepository,
    @Inject(USERS_CLOCK) private readonly clock: Clock,
  ) {}

  /** A new code for `me`, replacing the previous one. Its token is in this answer only. */
  async issue(me: string): Promise<{ token: string; expiresAt: Date }> {
    const token = newSecretToken();
    const expiresAt = new Date(
      this.clock.now().getTime() + CONTACT_CODE_TTL_MS,
    );
    await this.codes.replace({
      userId: me,
      tokenHash: secretTokenHash(token),
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Whose valid code `token` is; null for an unknown, replaced or expired one. */
  async ownerOf(token: unknown): Promise<string | null> {
    return validOwner(
      isSecretToken(token)
        ? await this.codes.findByToken(secretTokenHash(token))
        : null,
      this.clock.now(),
    );
  }
}

export function validOwner(code: ContactCode | null, now: Date): string | null {
  return code && isValid(code, now) ? code.userId : null;
}
