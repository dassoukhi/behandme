import { Inject, Injectable } from "@nestjs/common";
import { NotFoundError } from "@lib/kernel";
import { ContactCodeService } from "../../users/application/contact-code.service.js";
import { ProfileService } from "../../users/application/profile.service.js";
import type { Profile } from "../../users/domain/profile.js";
import type { RegisteredKeys } from "../domain/keys.js";
import { KEY_REPOSITORY, type KeyRepository } from "./ports.js";

/** What scanning someone's contact code gives: who they are, and the keys the server holds for them. */
export interface ScannedContact {
  /** As the scanner may see them: contact details only if they already trust the scanner. */
  user: Profile;
  keys: RegisteredKeys;
  /** The scanner's own code. */
  own: boolean;
}

/**
 * Contact codes as the phones use them (the app's docs/crypto-protocol.md, "Contact code"): a user shows one only
 * with keys; whoever scans it reads their profile and public keys, which the scanner's phone compares with the
 * fingerprint the code carries before adding them. The codes themselves live with the users (ContactCodeService).
 */
@Injectable()
export class ScannedContactService {
  constructor(
    private readonly codes: ContactCodeService,
    @Inject(KEY_REPOSITORY) private readonly keys: KeyRepository,
    private readonly profiles: ProfileService,
  ) {}

  /** A new code for `me`, who must have keys: the code exists to have them checked. */
  async issue(me: string): Promise<{ token: string; expiresAt: Date }> {
    if (!(await this.keys.find(me))) {
      throw new NotFoundError("No keys to show: create them first");
    }
    return this.codes.issue(me);
  }

  /** The user whose code `token` is, with their keys. Unknown and expired codes are not found. */
  async resolve(me: string, token: unknown): Promise<ScannedContact> {
    const owner = await this.codes.ownerOf(token);
    const notFound = new NotFoundError("Contact code not found");
    if (!owner) throw notFound;
    const keys = await this.keys.find(owner);
    if (!keys) throw notFound;
    const user = await this.profiles
      .findOne(me, owner)
      .catch((error: unknown) => {
        throw error instanceof NotFoundError ? notFound : error;
      });
    return { user, keys, own: owner === me };
  }
}
