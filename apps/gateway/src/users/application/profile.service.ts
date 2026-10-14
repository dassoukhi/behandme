import { Inject, Injectable } from "@nestjs/common";
import { UserDeleted } from "@lib/contracts";
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";
import type { Profile } from "../domain/profile.js";
import {
  CONTRACT_PARTICIPATION,
  IDENTITY_PROVIDER,
  PROFILE_REPOSITORY,
  USERS_UNIT_OF_WORK,
  type ContractParticipation,
  type IdentityProvider,
  type ProfileRepository,
  type UsersUnitOfWork,
} from "./ports.js";
import { TrustService } from "./trust.service.js";

const SEARCH_LIMIT = 20;

@Injectable()
export class ProfileService {
  constructor(
    @Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly trust: TrustService,
    @Inject(USERS_UNIT_OF_WORK) private readonly unitOfWork: UsersUnitOfWork,
    @Inject(CONTRACT_PARTICIPATION)
    private readonly participation: ContractParticipation,
  ) {}

  /**
   * Creates the caller's profile, or syncs it, from the verified identity (Clerk). The email is
   * never taken from the client, so nobody can claim someone else's address. Idempotent: safe
   * to call after every sign-in.
   */
  async ensureMe(
    me: string,
    names: { first_name?: string; last_name?: string } = {},
  ): Promise<{ profile: Profile; created: boolean }> {
    const identity = await this.identity.getProfile(me);
    if (!identity.email) {
      throw new UnprocessableError("The account has no verified email address");
    }
    const fields = {
      email: identity.email,
      first_name: names.first_name ?? identity.first_name,
      last_name: names.last_name ?? identity.last_name,
      avatar_url: identity.avatar_url,
    };

    const existing = await this.profiles.find(me);
    const profile = existing
      ? await this.profiles.update(me, fields)
      : await this.profiles.create(me, fields);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }
    return { profile, created: !existing };
  }

  async findMe(me: string): Promise<Profile> {
    const profile = await this.profiles.find(me);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }
    return profile;
  }

  /** The existing profiles among `ids`, as `me` may see them, by id. */
  async visibleProfiles(
    me: string,
    ids: string[],
  ): Promise<Map<string, Profile>> {
    const profiles = await this.profiles.findMany([...new Set(ids)]);
    const seen = await this.trust.asSeenBy(me, profiles);
    return new Map(seen.map((profile) => [profile.id, profile]));
  }

  /** Another user's profile, with contact details only if they trust `me`. */
  async findOne(me: string, id: string): Promise<Profile> {
    const profile = await this.profiles.find(id);
    if (!profile) {
      throw new NotFoundError(`User with ID ${id} not found`);
    }
    const [seen] = await this.trust.asSeenBy(me, [profile]);
    return seen;
  }

  async updateMe(
    me: string,
    fields: { phone_number?: string },
  ): Promise<Profile> {
    const profile = await this.profiles.update(me, fields);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }
    return profile;
  }

  /**
   * Deletes the profile; the other services then forget the user (event user.deleted), and handover
   * deletes their drafts. Refused while they take part in someone else's contract: that needs the
   * account-deletion saga (phase 6), which tells the owners.
   */
  async removeMe(me: string): Promise<void> {
    if (await this.participation.takesPartInOthersContracts(me)) {
      throw new ConflictError(
        "You are the accessor or a validator of someone else's contract: ask them to remove you first",
      );
    }
    await this.unitOfWork.run(async ({ profiles, events }) => {
      if (!(await profiles.delete(me))) {
        throw new NotFoundError("Profile not found");
      }
      await events.publish(UserDeleted.create({ userId: me }));
    });
  }

  /**
   * Partial match on first/last name, exact (case-insensitive) match on email. Excludes the
   * caller and the users they already trust; sorted by first name.
   */
  async search(me: string, query: string): Promise<Profile[]> {
    const term = query?.trim();
    if (!term) {
      throw new InvalidInputError("Search query cannot be empty");
    }

    const [candidates, trusted] = await Promise.all([
      this.profiles.search(term, SEARCH_LIMIT),
      this.trust.trustedIds(me),
    ]);
    const unique = new Map<string, Profile>();
    for (const profile of candidates) {
      if (profile.id !== me && !trusted.has(profile.id)) {
        unique.set(profile.id, profile);
      }
    }

    const results = [...unique.values()]
      .sort((a, b) => (a.first_name ?? "").localeCompare(b.first_name ?? ""))
      .slice(0, SEARCH_LIMIT);
    return this.trust.asSeenBy(me, results);
  }
}
