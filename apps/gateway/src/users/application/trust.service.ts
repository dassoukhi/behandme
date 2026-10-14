import { Inject, Injectable } from "@nestjs/common";
import { TrustAdded } from "@lib/contracts";
import { ConflictError, NotFoundError } from "@lib/kernel";
import { type Profile, visibleTo } from "../domain/profile.js";
import {
  assertCanTrust,
  displayName,
  type TrustLink,
} from "../domain/trust.js";
import {
  TRUST_REPOSITORY,
  USERS_UNIT_OF_WORK,
  type TrustRepository,
  type UsersUnitOfWork,
} from "./ports.js";

@Injectable()
export class TrustService {
  constructor(
    @Inject(TRUST_REPOSITORY) private readonly trust: TrustRepository,
    @Inject(USERS_UNIT_OF_WORK) private readonly unitOfWork: UsersUnitOfWork,
  ) {}

  /** `me` trusts `trustedId`, who is told about it (event trust.added). */
  async add(me: string, trustedId: string): Promise<TrustLink> {
    assertCanTrust(me, trustedId);
    return this.unitOfWork.run(async ({ profiles, trust, events }) => {
      const [owner, trusted] = await Promise.all([
        profiles.find(me),
        profiles.find(trustedId),
      ]);
      if (!trusted) {
        throw new NotFoundError(`User with ID ${trustedId} not found`);
      }
      if (!owner) {
        throw new NotFoundError("Profile not found");
      }
      const link = await trust.add(me, trustedId);
      if (!link) {
        throw new ConflictError("User is already trusted");
      }
      await events.publish(
        TrustAdded.create({
          ownerId: me,
          trustedId,
          ownerName: displayName(owner),
        }),
      );
      return link;
    });
  }

  /** `me` stops trusting `trustedId`. */
  async remove(me: string, trustedId: string): Promise<void> {
    if (!(await this.trust.remove(me, trustedId))) {
      throw new NotFoundError(`User with ID ${trustedId} is not trusted`);
    }
  }

  /** The users `me` trusts, as `me` may see them. */
  async listTrusted(me: string): Promise<Profile[]> {
    return this.asSeenBy(me, await this.trust.trustedProfiles(me));
  }

  /** The users who trust `me`; they all show `me` their contact details. */
  async listTrustedBy(me: string): Promise<Profile[]> {
    return this.asSeenBy(me, await this.trust.trusterProfiles(me));
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
