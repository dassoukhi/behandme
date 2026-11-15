import { InvalidInputError, isSecretToken, NotFoundError } from "@lib/kernel";

// An invitation: a link a user sends, through their own phone, to someone who may not have the app yet. Used once,
// within a week, by someone else: accepting it makes the inviter trust the invitee.

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;
/** Pending invitations a user may have at once: enough for a family, not for a mailing. */
export const MAX_PENDING_INVITATIONS = 20;
/** How long an expired invitation is kept before the retention deletes it. */
export const INVITATION_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** The retention deletes the invitations that expired before this date. */
export function invitationsKeptAfter(now: Date): Date {
  return new Date(now.getTime() - INVITATION_RETENTION_MS);
}

export interface Invitation {
  id: string;
  inviterId: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
}

export function isPending(invitation: Invitation, now: Date): boolean {
  return (
    invitation.acceptedAt === null &&
    invitation.cancelledAt === null &&
    invitation.expiresAt.getTime() > now.getTime()
  );
}

/** A token that cannot be one of ours is refused before any lookup. */
export function assertTokenShape(token: unknown): asserts token is string {
  if (!isSecretToken(token)) {
    throw new NotFoundError("Invitation not found");
  }
}

/**
 * The invitation `me` may accept: pending, and not their own. Used, cancelled or expired invitations look the same
 * as unknown ones (404): the link says nothing more to whoever holds it.
 */
export function assertAcceptable(
  invitation: Invitation | null,
  me: string,
  now: Date,
): Invitation {
  if (!invitation || !isPending(invitation, now)) {
    throw new NotFoundError("Invitation not found");
  }
  if (invitation.inviterId === me) {
    throw new InvalidInputError("You cannot accept your own invitation");
  }
  return invitation;
}
