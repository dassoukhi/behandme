import type { Profile } from "../domain/profile.js";
import type { TrustLink } from "../domain/trust.js";
import type {
  IdentityProfile,
  IdentityProvider,
  ProfileFields,
  ProfileRepository,
  TrustRepository,
} from "../application/ports.js";

/** Test doubles of the users ports, sharing one in-memory store. */
export class InMemoryUsers
  implements ProfileRepository, TrustRepository, IdentityProvider
{
  profiles = new Map<string, Profile>();
  links: TrustLink[] = [];
  identities = new Map<string, IdentityProfile>();

  // ProfileRepository
  async find(id: string) {
    return this.profiles.get(id) ?? null;
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
  async search(term: string, limit: number) {
    const all = [...this.profiles.values()];
    const has = (value?: string | null) =>
      (value ?? "").toLowerCase().includes(term.toLowerCase());
    return [
      ...all.filter((p) => has(p.first_name)).slice(0, limit),
      ...all.filter((p) => has(p.last_name)).slice(0, limit),
      ...all
        .filter((p) => p.email?.toLowerCase() === term.toLowerCase())
        .slice(0, limit),
    ];
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

  // IdentityProvider
  async getProfile(userId: string) {
    const identity = this.identities.get(userId);
    if (!identity) throw new Error(`unknown identity ${userId}`);
    return identity;
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
