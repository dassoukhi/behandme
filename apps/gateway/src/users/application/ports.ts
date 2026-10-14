import type { NewEvent } from "@lib/messaging";
import type { Profile } from "../domain/profile.js";
import type { TrustLink } from "../domain/trust.js";

/** Identity data owned by the authentication provider (never by the client). */
export interface IdentityProfile {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

/** Where the verified identity of a user comes from. */
export interface IdentityProvider {
  getProfile(userId: string): Promise<IdentityProfile>;
}
export const IDENTITY_PROVIDER = Symbol("IdentityProvider");

/** Profile fields the application writes. */
export type ProfileFields = Partial<
  Pick<
    Profile,
    "email" | "first_name" | "last_name" | "avatar_url" | "phone_number"
  >
>;

export interface ProfileRepository {
  find(id: string): Promise<Profile | null>;
  /** The profiles that exist among `ids`, in no particular order. */
  findMany(ids: string[]): Promise<Profile[]>;
  create(
    id: string,
    fields: ProfileFields & { email: string },
  ): Promise<Profile>;
  /** Null when there is no such profile. */
  update(id: string, fields: ProfileFields): Promise<Profile | null>;
  /** False when there was no such profile. */
  delete(id: string): Promise<boolean>;
  /**
   * Profiles whose first or last name contains `term`, then those whose email equals it (case
   * ignored), at most `limit` of each kind, in that order. A fragment never matches an email, so
   * addresses cannot be harvested.
   */
  search(term: string, limit: number): Promise<Profile[]>;
}
export const PROFILE_REPOSITORY = Symbol("ProfileRepository");

export interface TrustRepository {
  /** Null when `ownerId` already trusts `trustedId`. */
  add(ownerId: string, trustedId: string): Promise<TrustLink | null>;
  /** False when `ownerId` did not trust `trustedId`. */
  remove(ownerId: string, trustedId: string): Promise<boolean>;
  /** Profiles of the users `ownerId` trusts. */
  trustedProfiles(ownerId: string): Promise<Profile[]>;
  /** Profiles of the users who trust `trustedId`. */
  trusterProfiles(trustedId: string): Promise<Profile[]>;
  /** Ids of the users `ownerId` trusts: all of them, or those among `among`. */
  trustedIds(ownerId: string, among?: string[]): Promise<string[]>;
  /** Ids among `ownerIds` of the users who trust `trustedId`. */
  trusters(trustedId: string, ownerIds: string[]): Promise<string[]>;
}
export const TRUST_REPOSITORY = Symbol("TrustRepository");

/** What the handover service knows of a user's part in other people's contracts. */
export interface ContractParticipation {
  /** True when the user is the accessor or a validator of a contract they do not own. */
  takesPartInOthersContracts(userId: string): Promise<boolean>;
}
export const CONTRACT_PARTICIPATION = Symbol("ContractParticipation");

/** Events for the other services, published only if the transaction commits. */
export interface EventPublisher {
  publish(event: NewEvent): Promise<void>;
}

/** Repositories bound to one transaction, and the events it publishes. */
export interface UsersTransaction {
  profiles: ProfileRepository;
  trust: TrustRepository;
  events: EventPublisher;
}

/** Runs `work` in a transaction: its writes and events commit together or not at all. */
export interface UsersUnitOfWork {
  run<T>(work: (tx: UsersTransaction) => Promise<T>): Promise<T>;
}
export const USERS_UNIT_OF_WORK = Symbol("UsersUnitOfWork");
