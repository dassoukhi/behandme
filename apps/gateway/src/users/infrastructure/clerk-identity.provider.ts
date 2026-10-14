import { Inject, Injectable } from "@nestjs/common";
import type { ClerkClient } from "@clerk/backend";
import type {
  IdentityProfile,
  IdentityProvider,
} from "../application/ports.js";

/** Reads the user from Clerk with the backend secret key. */
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
