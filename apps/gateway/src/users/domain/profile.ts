/** A user's profile: identity fields come from Clerk, the phone number from the user. */
export interface Profile {
  id: string;
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  phone_number?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Contact details (email, phone) of a user are visible to the user themself and to the users
 * they trust (rows in `trusted` with owner_id = them).
 */
export function visibleTo<T extends Profile>(
  profile: T,
  viewerId: string,
  trustsViewer: boolean,
): T {
  if (profile.id === viewerId || trustsViewer) {
    return profile;
  }
  const publicProfile = { ...profile };
  delete publicProfile.email;
  delete publicProfile.phone_number;
  return publicProfile;
}
