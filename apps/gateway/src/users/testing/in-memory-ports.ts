import type { NewEvent } from "@lib/messaging";
import type { ContactCode } from "../domain/contact-code.js";
import type { Invitation } from "../domain/invitation.js";
import type { Profile } from "../domain/profile.js";
import type { TrustLink } from "../domain/trust.js";
import type {
  ContactCodeRepository,
  IdentityProfile,
  IdentityProvider,
  InvitationRepository,
  ProfileFields,
  ProfileRepository,
  TrustRepository,
  UsersTransaction,
  UsersUnitOfWork,
} from "../application/ports.js";

/**
 * Test doubles of the users ports, sharing one in-memory store. The unit of work keeps the events
 * of a failed transaction out of `published`; it does not undo the store's writes.
 */
export class InMemoryUsers
  implements
    ProfileRepository,
    TrustRepository,
    IdentityProvider,
    UsersUnitOfWork
{
  /** core.invitations, with each one's token hash (hex). */
  invitationRows: (Invitation & { tokenHash: string })[] = [];
  /** core.contact_codes, with each one's token hash (hex). */
  contactCodeRows: (ContactCode & { tokenHash: string })[] = [];
  profiles = new Map<string, Profile>();
  links: TrustLink[] = [];
  identities = new Map<string, IdentityProfile>();
  published: NewEvent[] = [];
  /** Accounts deleted at the identity provider. */
  deletedUsers: string[] = [];

  // UsersUnitOfWork
  async run<T>(work: (tx: UsersTransaction) => Promise<T>): Promise<T> {
    const staged: NewEvent[] = [];
    const result = await work({
      profiles: this,
      trust: this,
      invitations: this.invitations,
      contactCodes: this.contactCodes,
      events: { publish: async (event) => void staged.push(event) },
    });
    this.published.push(...staged);
    return result;
  }

  // ProfileRepository
  async find(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async findByEmail(email: string) {
    const wanted = email.trim().toLowerCase();
    return [...this.profiles.values()].filter(
      (p) => p.email?.toLowerCase() === wanted,
    );
  }
  async create(id: string, fields: ProfileFields) {
    const profile = {
      id,
      ...fields,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    this.profiles.set(id, profile);
    return profile;
  }
  async update(id: string, fields: ProfileFields) {
    const profile = this.profiles.get(id);
    if (!profile) return null;
    Object.assign(profile, fields);
    return profile;
  }
  async delete(id: string) {
    return this.profiles.delete(id);
  }
  async lock(id: string) {
    return this.profiles.has(id);
  }
  async findMany(ids: string[]) {
    return ids
      .map((id) => this.profiles.get(id))
      .filter((p): p is Profile => p !== undefined);
  }

  // TrustRepository
  async add(ownerId: string, trustedId: string) {
    if (
      this.links.some(
        (l) => l.owner_id === ownerId && l.trusted_id === trustedId,
      )
    ) {
      return null;
    }
    const link = {
      id: `link-${this.links.length + 1}`,
      owner_id: ownerId,
      trusted_id: trustedId,
      created_at: null,
    };
    this.links.push(link);
    return link;
  }
  async remove(ownerId: string, trustedId: string) {
    const before = this.links.length;
    this.links = this.links.filter(
      (l) => !(l.owner_id === ownerId && l.trusted_id === trustedId),
    );
    return this.links.length < before;
  }
  async trusterProfiles(trustedId: string) {
    return this.links
      .filter((l) => l.trusted_id === trustedId)
      .map((l) => this.profiles.get(l.owner_id))
      .filter((p): p is Profile => p !== undefined);
  }
  async trustedProfiles(ownerId: string) {
    return this.links
      .filter((l) => l.owner_id === ownerId)
      .map((l) => this.profiles.get(l.trusted_id))
      .filter((p): p is Profile => p !== undefined);
  }
  async trustedIds(ownerId: string, among?: string[]) {
    return this.links
      .filter((l) => l.owner_id === ownerId)
      .map((l) => l.trusted_id)
      .filter((id) => !among || among.includes(id));
  }
  async trusters(trustedId: string, ownerIds: string[]) {
    return this.links
      .filter(
        (l) => l.trusted_id === trustedId && ownerIds.includes(l.owner_id),
      )
      .map((l) => l.owner_id);
  }

  // InvitationRepository (a separate object: its method names would clash with the trust links')
  invitations: InvitationRepository = {
    create: async ({ inviterId, tokenHash, expiresAt }) => {
      const row = {
        id: `inv-${this.invitationRows.length + 1}`,
        inviterId,
        tokenHash: hex(tokenHash),
        createdAt: new Date(expiresAt.getTime() - 7 * 24 * 60 * 60_000),
        expiresAt,
        acceptedBy: null,
        acceptedAt: null,
        cancelledAt: null,
      };
      this.invitationRows.push(row);
      return invitationOf(row);
    },
    findByToken: async (tokenHash) => {
      const row = this.invitationRows.find(
        (r) => r.tokenHash === hex(tokenHash),
      );
      return row ? invitationOf(row) : null;
    },
    findByTokenForUpdate: (tokenHash) =>
      this.invitations.findByToken(tokenHash),
    countPending: async (inviterId, now) =>
      (await this.invitations.pending(inviterId, now)).length,
    pending: async (inviterId, now) =>
      this.invitationRows
        .filter((r) => r.inviterId === inviterId && pendingAt(r, now))
        .reverse()
        .map(invitationOf),
    cancel: async (inviterId, id, now) => {
      const row = this.invitationRows.find(
        (r) => r.id === id && r.inviterId === inviterId && pendingAt(r, now),
      );
      if (!row) return false;
      row.cancelledAt = now;
      return true;
    },
    accept: async (id, inviteeId, now) => {
      const row = this.invitationRows.find(
        (r) => r.id === id && pendingAt(r, now),
      );
      if (!row) return false;
      row.acceptedBy = inviteeId;
      row.acceptedAt = now;
      return true;
    },
    deleteExpiredBefore: async (before) => {
      const kept = this.invitationRows.filter((r) => r.expiresAt >= before);
      const deleted = this.invitationRows.length - kept.length;
      this.invitationRows = kept;
      return deleted;
    },
  };

  // ContactCodeRepository
  contactCodes: ContactCodeRepository = {
    replace: async ({ userId, tokenHash, expiresAt }) => {
      this.contactCodeRows = this.contactCodeRows.filter(
        (r) => r.userId !== userId,
      );
      this.contactCodeRows.push({
        userId,
        tokenHash: hex(tokenHash),
        expiresAt,
      });
    },
    findByToken: async (tokenHash) => {
      const row = this.contactCodeRows.find(
        (r) => r.tokenHash === hex(tokenHash),
      );
      return row ? { userId: row.userId, expiresAt: row.expiresAt } : null;
    },
    deleteExpired: async (now) => {
      const kept = this.contactCodeRows.filter((r) => r.expiresAt > now);
      const deleted = this.contactCodeRows.length - kept.length;
      this.contactCodeRows = kept;
      return deleted;
    },
  };

  // IdentityProvider
  async getProfile(userId: string) {
    const identity = this.identities.get(userId);
    if (!identity) throw new Error(`unknown identity ${userId}`);
    return identity;
  }

  /** Ids Clerk has no account for: never had one, or already deleted it. */
  clerkGone = new Set<string>();

  async deleteUser(userId: string) {
    this.deletedUsers.push(userId);
    if (this.clerkGone.has(userId)) return false;
    this.clerkGone.add(userId);
    return true;
  }

  /** Adds a profile with contact details. */
  person(id: string, firstName = id) {
    this.profiles.set(id, {
      id,
      email: `${id}@example.com`,
      phone_number: "+33600000000",
      first_name: firstName,
      last_name: "Test",
      avatar_url: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    return this;
  }

  trusts(ownerId: string, trustedId: string) {
    void this.add(ownerId, trustedId);
    return this;
  }
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

const pendingAt = (row: Invitation, now: Date) =>
  row.acceptedAt === null &&
  row.cancelledAt === null &&
  row.expiresAt.getTime() > now.getTime();

const invitationOf = (row: Invitation): Invitation => ({
  id: row.id,
  inviterId: row.inviterId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  acceptedBy: row.acceptedBy,
  acceptedAt: row.acceptedAt,
  cancelledAt: row.cancelledAt,
});
