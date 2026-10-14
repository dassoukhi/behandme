import { InvalidInputError } from "@lib/kernel";
import type { Profile } from "./profile.js";

/** `owner_id` trusts `trusted_id`: the trusted user may see the owner's contact details. */
export interface TrustLink {
  id: string;
  owner_id: string;
  trusted_id: string;
  created_at: string | null;
}

export function assertCanTrust(ownerId: string, trustedId: string): void {
  if (ownerId === trustedId) {
    throw new InvalidInputError("You cannot trust yourself");
  }
}

/** How a user is named to others: first and last name, or null when they have neither. */
export function displayName(profile: Profile): string | null {
  const name = [profile.first_name, profile.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || null;
}
