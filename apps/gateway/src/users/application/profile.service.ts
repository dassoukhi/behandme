import { Inject, Injectable } from "@nestjs/common";
import { UserDeleted, UserProfileChanged } from "@lib/contracts";
import { NotFoundError, UnprocessableError } from "@lib/kernel";
import type { Profile } from "../domain/profile.js";
import {
  type FactorVerificationAge,
  recentlyVerified,
  ReverificationRequired,
} from "../../auth/domain/reverification.js";
import {
  IDENTITY_PROVIDER,
  PROFILE_REPOSITORY,
  USERS_UNIT_OF_WORK,
  type IdentityProvider,
  type ProfileRepository,
  type UsersUnitOfWork,
} from "./ports.js";
import { TrustService } from "./trust.service.js";

@Injectable()
export class ProfileService {
  constructor(
    @Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly trust: TrustService,
    @Inject(USERS_UNIT_OF_WORK) private readonly unitOfWork: UsersUnitOfWork,
  ) {}

  /**
   * Creates the caller's profile, or syncs it, from the verified identity (Clerk). The email is
   * never taken from the client, so nobody can claim someone else's address. Idempotent: safe
   * to call after every sign-in. Each sync tells the notifier the address and name
   * (user.profile_changed), in the same transaction: the address only once the provider verified
   * it. At every sync rather than on change, since the gateway does not keep whether the address
   * was verified, and so that a lost event is made good at the next sign-in.
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

    return this.unitOfWork.run(async ({ profiles, events }) => {
      const existing = await profiles.find(me);
      const profile = existing
        ? await profiles.update(me, fields)
        : await profiles.create(me, fields);
      if (!profile) {
        throw new NotFoundError("Profile not found");
      }
      await events.publish(
        UserProfileChanged.create({
          userId: me,
          email: identity.email_verified ? (profile.email ?? null) : null,
          firstName: profile.first_name ?? null,
          lastName: profile.last_name ?? null,
        }),
      );
      return { profile, created: !existing };
    });
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
   * Deletes the account, after a recent Clerk reverification (a stolen session must not be enough).
   * The profile goes (its keys and trust links with it) and user.deleted tells the other services:
   * handover revokes the user's contracts and closes the claims they filed or would receive, the
   * notifier forgets their notifications. Then the Clerk account goes. A second call after a failure
   * at Clerk finishes the job without publishing twice.
   */
  async removeMe(me: string, fva: FactorVerificationAge | null): Promise<void> {
    if (!recentlyVerified(fva)) throw new ReverificationRequired();
    await this.remove(me);
  }

  /**
   * The profile with this id, or those with this e-mail address when `idOrEmail` has an @: several when an old
   * profile kept the address of a new account, since the column is not unique.
   */
  async findAccounts(idOrEmail: string): Promise<Profile[]> {
    const wanted = idOrEmail.trim();
    if (wanted.includes("@")) return this.profiles.findByEmail(wanted);
    const profile = await this.profiles.find(wanted);
    return profile ? [profile] : [];
  }

  /**
   * The same deletion, for support, once it has checked the request (close-account.ts): heirs under article 85 of
   * the loi Informatique et Libertés, or someone who lost access to the app. No session, so no reverification.
   * Says what there was to delete: neither a profile nor a Clerk account means a wrong id.
   */
  closeAccount(
    userId: string,
  ): Promise<{ profile: boolean; identity: boolean }> {
    return this.remove(userId);
  }

  private async remove(
    userId: string,
  ): Promise<{ profile: boolean; identity: boolean }> {
    const profile = await this.unitOfWork.run(async ({ profiles, events }) => {
      if (!(await profiles.delete(userId))) return false;
      await events.publish(UserDeleted.create({ userId }));
      return true;
    });
    return { profile, identity: await this.identity.deleteUser(userId) };
  }
}
