import { InvalidInputError } from "@lib/kernel";

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
