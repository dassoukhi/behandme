import type { NewEvent } from "@lib/messaging";
import type { ContactCode } from "../domain/contact-code.js";
import type { Invitation } from "../domain/invitation.js";
import type { Profile } from "../domain/profile.js";
import type { TrustLink } from "../domain/trust.js";

/** Identity data owned by the authentication provider (never by the client). */
export interface IdentityProfile {
  email: string | null;
  /** Whether the provider verified `email` (a code sent to it, or a trusted sign-in provider). */
  email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

/** Where the verified identity of a user comes from. */
export interface IdentityProvider {
  getProfile(userId: string): Promise<IdentityProfile>;
  /** Deletes the account at the provider (Clerk); done when it is already gone. */
  deleteUser(userId: string): Promise<void>;
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
  /** The profile with this e-mail address, whatever its case; null when there is none. */
  findByEmail(email: string): Promise<Profile | null>;
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
  /** Locks the profile's row until the transaction ends (false when there is none): one change at a time. */
  lock(id: string): Promise<boolean>;
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

/** core.invitations. Tokens are looked up by their hash only (`secretTokenHash`). */
export interface InvitationRepository {
  create(invitation: {
    inviterId: string;
    tokenHash: Uint8Array;
    expiresAt: Date;
  }): Promise<Invitation>;
  /** The invitation whose token hashes to `tokenHash`, in any state. */
  findByToken(tokenHash: Uint8Array): Promise<Invitation | null>;
  /** The same, locked until the transaction ends: two acceptances of one link cannot both pass. */
  findByTokenForUpdate(tokenHash: Uint8Array): Promise<Invitation | null>;
  /** `inviterId`'s invitations still pending at `now`, newest first. */
  pending(inviterId: string, now: Date): Promise<Invitation[]>;
  /** How many of them. */
  countPending(inviterId: string, now: Date): Promise<number>;
  /** False when `inviterId` has no pending invitation `id`. */
  cancel(inviterId: string, id: string, now: Date): Promise<boolean>;
  /** Marks a pending invitation used by `inviteeId`; false when it no longer is pending. */
  accept(id: string, inviteeId: string, now: Date): Promise<boolean>;
  /** Deletes the invitations that expired before `before`, whatever their state; returns how many. */
  deleteExpiredBefore(before: Date): Promise<number>;
}
export const INVITATION_REPOSITORY = Symbol("InvitationRepository");

/** core.contact_codes: one per user. Tokens are looked up by their hash only (`secretTokenHash`). */
export interface ContactCodeRepository {
  /** The user's only code: replaces the one they had. */
  replace(code: ContactCode & { tokenHash: Uint8Array }): Promise<void>;
  findByToken(tokenHash: Uint8Array): Promise<ContactCode | null>;
  deleteExpired(now: Date): Promise<number>;
}
export const CONTACT_CODE_REPOSITORY = Symbol("ContactCodeRepository");

/** Events for the other services, published only if the transaction commits. */
export interface EventPublisher {
  publish(event: NewEvent): Promise<void>;
}

/** Repositories bound to one transaction, and the events it publishes. */
export interface UsersTransaction {
  profiles: ProfileRepository;
  trust: TrustRepository;
  invitations: InvitationRepository;
  contactCodes: ContactCodeRepository;
  events: EventPublisher;
}

/** Runs `work` in a transaction: its writes and events commit together or not at all. */
export interface UsersUnitOfWork {
  run<T>(work: (tx: UsersTransaction) => Promise<T>): Promise<T>;
}
export const USERS_UNIT_OF_WORK = Symbol("UsersUnitOfWork");

export const USERS_CLOCK = Symbol("UsersClock");
