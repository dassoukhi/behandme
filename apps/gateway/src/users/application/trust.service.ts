import { Inject, Injectable } from "@nestjs/common";
import { ConflictError, NotFoundError } from "@lib/kernel";
import { type Profile, visibleTo } from "../domain/profile.js";
import { assertCanTrust, type TrustLink } from "../domain/trust.js";
import {
  PROFILE_REPOSITORY,
  TRUST_REPOSITORY,
  type ProfileRepository,
  type TrustRepository,
} from "./ports.js";

@Injectable()
export class TrustService {
  constructor(
    @Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository,
    @Inject(TRUST_REPOSITORY) private readonly trust: TrustRepository,
  ) {}

  /** `me` trusts `trustedId`. */
  async add(me: string, trustedId: string): Promise<TrustLink> {
    assertCanTrust(me, trustedId);
    if (!(await this.profiles.find(trustedId))) {
      throw new NotFoundError(`User with ID ${trustedId} not found`);
    }
    const link = await this.trust.add(me, trustedId);
    if (!link) {
      throw new ConflictError("User is already trusted");
    }
    return link;
  }

  /** The users `me` trusts, as `me` may see them. */
  async listTrusted(me: string): Promise<Profile[]> {
    return this.asSeenBy(me, await this.trust.trustedProfiles(me));
  }

  /** Ids of every user `me` trusts. */
  async trustedIds(me: string): Promise<Set<string>> {
    return new Set(await this.trust.trustedIds(me));
  }

  /** Ids among `ids` of users that `me` trusts. */
  async trustedAmong(me: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }
    return new Set(await this.trust.trustedIds(me, ids));
  }

  /** Ids among `ids` of users who trust `me`. */
  async whoTrusts(me: string, ids: string[]): Promise<Set<string>> {
    const others = ids.filter((id) => id !== me);
    if (others.length === 0) {
      return new Set();
    }
    return new Set(await this.trust.trusters(me, others));
  }

  /** Applies the contact-details visibility rule for viewer `me`. */
  async asSeenBy<T extends Profile>(me: string, profiles: T[]): Promise<T[]> {
    const trustingMe = await this.whoTrusts(
      me,
      profiles.map((p) => p.id),
    );
    return profiles.map((p) => visibleTo(p, me, trustingMe.has(p.id)));
  }
}
