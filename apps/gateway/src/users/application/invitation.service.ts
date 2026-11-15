import { Inject, Injectable } from "@nestjs/common";
import { InvitationAccepted } from "@lib/contracts";
import {
  type Clock,
  ConflictError,
  newSecretToken,
  NotFoundError,
  secretTokenHash,
} from "@lib/kernel";
import {
  assertAcceptable,
  assertTokenShape,
  INVITATION_TTL_MS,
  type Invitation,
  isPending,
  MAX_PENDING_INVITATIONS,
} from "../domain/invitation.js";
import type { Profile } from "../domain/profile.js";
import { displayName } from "../domain/trust.js";
import {
  INVITATION_REPOSITORY,
  USERS_CLOCK,
  USERS_UNIT_OF_WORK,
  type InvitationRepository,
  type UsersUnitOfWork,
} from "./ports.js";
import { ProfileService } from "./profile.service.js";

/** What the holder of a link sees before accepting it. */
export interface InvitationPreview {
  /** The inviter, as the holder may see them: their contact details only if they already trust the holder. */
  inviter: Profile;
  expiresAt: Date;
  /** The holder is the inviter: they opened their own link. */
  own: boolean;
}

/**
 * Invitations: a user sends a link (through their phone, never by our e-mails); the person who accepts it
 * enters the inviter's proches, and may add the inviter to theirs. Each person decides who sees their own
 * contact details: the inviter by sending the link, the invitee with `trustBack`.
 */
@Injectable()
export class InvitationService {
  constructor(
    @Inject(INVITATION_REPOSITORY)
    private readonly invitations: InvitationRepository,
    private readonly profiles: ProfileService,
    @Inject(USERS_UNIT_OF_WORK) private readonly unitOfWork: UsersUnitOfWork,
    @Inject(USERS_CLOCK) private readonly clock: Clock,
  ) {}

  /** A new invitation of `me`. Its token is in this answer only: the server keeps its hash. */
  async create(me: string): Promise<{ invitation: Invitation; token: string }> {
    const now = this.clock.now();
    return this.unitOfWork.run(async ({ profiles, invitations }) => {
      // The inviter's row stays locked until the end: two invitations made at once count each other.
      if (!(await profiles.lock(me))) {
        throw new NotFoundError("Profile not found");
      }
      if (
        (await invitations.countPending(me, now)) >= MAX_PENDING_INVITATIONS
      ) {
        throw new ConflictError(
          `At most ${MAX_PENDING_INVITATIONS} pending invitations: cancel one first`,
        );
      }
      const token = newSecretToken();
      const invitation = await invitations.create({
        inviterId: me,
        tokenHash: secretTokenHash(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      });
      return { invitation, token };
    });
  }

  /** `me`'s invitations nobody has accepted yet, newest first. */
  pending(me: string): Promise<Invitation[]> {
    return this.invitations.pending(me, this.clock.now());
  }

  /** `me` takes back a pending invitation: its link stops working. */
  async cancel(me: string, id: string): Promise<void> {
    if (!(await this.invitations.cancel(me, id, this.clock.now()))) {
      throw new NotFoundError("Invitation not found");
    }
  }

  /** Who invites the holder of `token`. A used, cancelled or expired link is not found. */
  async preview(me: string, token: unknown): Promise<InvitationPreview> {
    assertTokenShape(token);
    const invitation = await this.invitations.findByToken(
      secretTokenHash(token),
    );
    if (!invitation || !isPending(invitation, this.clock.now())) {
      throw new NotFoundError("Invitation not found");
    }
    const inviter = await this.profiles
      .findOne(me, invitation.inviterId)
      .catch((error: unknown) => {
        throw error instanceof NotFoundError
          ? new NotFoundError("Invitation not found")
          : error;
      });
    return {
      inviter,
      expiresAt: invitation.expiresAt,
      own: invitation.inviterId === me,
    };
  }

  /**
   * `me` accepts: from now on the inviter trusts them, and they trust the inviter if `trustBack`. The link is used
   * up in the same transaction, and the inviter is told (invitation.accepted), once.
   */
  async accept(
    me: string,
    token: unknown,
    trustBack: boolean,
  ): Promise<{ inviterId: string; trustedBack: boolean }> {
    assertTokenShape(token);
    const now = this.clock.now();
    return this.unitOfWork.run(
      async ({ profiles, trust, invitations, events }) => {
        const invitation = assertAcceptable(
          await invitations.findByTokenForUpdate(secretTokenHash(token)),
          me,
          now,
        );
        const [inviter, invitee] = await Promise.all([
          profiles.find(invitation.inviterId),
          profiles.find(me),
        ]);
        if (!inviter) {
          throw new NotFoundError("Invitation not found");
        }
        if (!invitee) {
          throw new NotFoundError("Profile not found");
        }
        if (!(await invitations.accept(invitation.id, me, now))) {
          throw new NotFoundError("Invitation not found");
        }
        // Already linked (a code scanned earlier, say): the link stays as it is.
        await trust.add(invitation.inviterId, me);
        if (trustBack) await trust.add(me, invitation.inviterId);
        // Whether the invitee trusts the inviter now, newly or from before.
        const trustedBack =
          (await trust.trustedIds(me, [invitation.inviterId])).length > 0;
        await events.publish(
          InvitationAccepted.create({
            inviterId: invitation.inviterId,
            inviteeId: me,
            inviteeName: displayName(invitee),
            trustedBack,
          }),
        );
        return { inviterId: invitation.inviterId, trustedBack };
      },
    );
  }
}
