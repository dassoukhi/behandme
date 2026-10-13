import { UserProfileDto } from "./dto/user-profile.dto.js";

/**
 * Contact details (email, phone) of a user are visible to the user themself and
 * to the users they trust (rows in `trusted` with owner_id = them).
 */
export function projectProfile<T extends UserProfileDto>(
  user: T,
  viewerId: string,
  trustsViewer: boolean,
): T {
  if (user.id === viewerId || trustsViewer) {
    return user;
  }
  const publicProfile = { ...user };
  delete publicProfile.email;
  delete publicProfile.phone_number;
  return publicProfile;
}
