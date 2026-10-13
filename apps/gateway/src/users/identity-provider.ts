import { Inject, Injectable } from "@nestjs/common";
import type { ClerkClient } from "@clerk/backend";

/** Identity data owned by the authentication provider (never by the client). */
export interface IdentityProfile {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

/** Port: where the verified identity of a user comes from. */
export interface IdentityProvider {
  getProfile(userId: string): Promise<IdentityProfile>;
}

export const IDENTITY_PROVIDER = Symbol("IdentityProvider");

/** Adapter: reads the user from Clerk with the backend secret key. */
@Injectable()
export class ClerkIdentityProvider implements IdentityProvider {
  constructor(@Inject("ClerkClient") private readonly clerk: ClerkClient) {}

  async getProfile(userId: string): Promise<IdentityProfile> {
    const user = await this.clerk.users.getUser(userId);
    const primary = user.emailAddresses.find(
      (address) => address.id === user.primaryEmailAddressId,
    );
    return {
      email: primary?.emailAddress ?? null,
      first_name: user.firstName,
      last_name: user.lastName,
      avatar_url: user.imageUrl || null,
    };
  }
}
