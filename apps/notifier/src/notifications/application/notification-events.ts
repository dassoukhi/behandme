import { Inject, Injectable } from "@nestjs/common";
import { type Clock } from "@lib/kernel";
import {
  chosenAsAccessor,
  chosenAsValidator,
  claimClosed,
  claimFiledForOwner,
  claimFiledForValidator,
  claimQuorumReached,
  claimReminderForOwner,
  claimReminderForValidator,
  contactKeysReset,
  contractReleasedForAccessor,
  contractRevoked,
  invitationAccepted,
  keyCheckup,
  keysBackupOpened,
  keysReset,
  keysTransferred,
  participantLeft,
  phraseCheck,
  rulesChanged,
  trustAdded,
} from "../domain/templates.js";
import { NotifyService } from "./notify.service.js";
import { CLOCK, type NotifierStore } from "./ports.js";

/** Notifier reactions to the other services' events. Each runs in the event's transaction. */
@Injectable()
export class NotificationEvents {
  constructor(
    private readonly notifier: NotifyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Tell the person who was added. */
  async trustAdded(
    store: NotifierStore,
    event: { ownerId: string; trustedId: string; ownerName: string | null },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(
      store,
      [
        trustAdded({
          userId: event.trustedId,
          ownerId: event.ownerId,
          ownerName: event.ownerName,
        }),
      ],
      occurredAt,
    );
  }

  /** Tell the inviter who accepted, and whether they trust the inviter back. */
  async invitationAccepted(
    store: NotifierStore,
    event: {
      inviterId: string;
      inviteeId: string;
      inviteeName: string | null;
      trustedBack: boolean;
    },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(
      store,
      [
        invitationAccepted({
          userId: event.inviterId,
          inviteeId: event.inviteeId,
          inviteeName: event.inviteeName,
          trustedBack: event.trustedBack,
        }),
      ],
      occurredAt,
    );
  }

  /** Alert the user (it may not have been them), and tell the people who may encrypt to them. */
  async keysRotated(
    store: NotifierStore,
    event: {
      userId: string;
      userName: string | null;
      usableFrom: string;
      trusterIds: string[];
    },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(
      store,
      [
        keysReset({ userId: event.userId, usableFrom: event.usableFrom }),
        ...event.trusterIds.map((trusterId) =>
          contactKeysReset({
            trusterId,
            userId: event.userId,
            userName: event.userName,
          }),
        ),
      ],
      occurredAt,
    );
  }

  /** Alert the user: it may not have been them. */
  async keysTransferred(
    store: NotifierStore,
    event: { userId: string },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(store, [keysTransferred(event)], occurredAt);
  }

  /** Alert the user: it may not have been them. */
  async keysBackupOpened(
    store: NotifierStore,
    event: { userId: string },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(store, [keysBackupOpened(event)], occurredAt);
  }

  /** A check of the recovery phrase, or the yearly check-up, is due. */
  async keyCareReminder(
    store: NotifierStore,
    event: { userId: string; kind: "phrase_check" | "key_checkup" },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(
      store,
      [event.kind === "phrase_check" ? phraseCheck(event) : keyCheckup(event)],
      occurredAt,
    );
  }

  /** Those named for the first time: each new validator, and the accessor when they are new too. */
  async contractSealed(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      accessorId: string;
      newAccessor: boolean;
      newValidatorIds: string[];
      validatorCount: number;
      threshold: number;
      contestDays: number;
      incapacityAllowed: boolean;
    },
    occurredAt?: string,
  ): Promise<void> {
    const rules = {
      ownerId: event.ownerId,
      category: event.category,
      validatorCount: event.validatorCount,
      threshold: event.threshold,
      contestDays: event.contestDays,
      incapacityAllowed: event.incapacityAllowed,
    };
    await this.notifier.notify(
      store,
      [
        ...event.newValidatorIds.map((validatorId) =>
          chosenAsValidator({ ...rules, validatorId }),
        ),
        ...(event.newAccessor
          ? [
              chosenAsAccessor({
                ...rules,
                accessorId: event.accessorId,
                contractId: event.contractId,
              }),
            ]
          : []),
      ],
      occurredAt,
    );
  }

  /** Alert the owner (they may stop it), ask the other validators for their decision. */
  async claimFiled(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      claimantId: string;
      reason: string;
      validatorIds: string[];
      contestUntil: string;
    },
    occurredAt?: string,
  ): Promise<void> {
    const claim = { ...event, claimReason: event.reason };
    await this.notifier.notify(
      store,
      [
        claimFiledForOwner(claim),
        ...event.validatorIds
          .filter((id) => id !== event.claimantId)
          .map((validatorId) =>
            claimFiledForValidator({ ...claim, validatorId }),
          ),
      ],
      occurredAt,
    );
  }

  async claimQuorumReached(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      contestUntil: string;
    },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(store, [claimQuorumReached(event)], occurredAt);
  }

  /** The owner's last chance, and validators who have not decided yet. */
  async claimReminder(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      pendingValidatorIds: string[];
      quorum: boolean;
      contestUntil: string;
      last: boolean;
    },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(
      store,
      [
        claimReminderForOwner(event),
        ...event.pendingValidatorIds.map((validatorId) =>
          claimReminderForValidator({ ...event, validatorId }),
        ),
      ],
      occurredAt,
    );
  }

  /** Everyone involved but whoever closed it. */
  async claimClosed(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      reason: string;
      closedBy: string | null;
      ownerId: string;
      claimantId: string;
      validatorIds: string[];
    },
    occurredAt?: string,
  ): Promise<void> {
    const people = new Set([
      event.ownerId,
      event.claimantId,
      ...event.validatorIds,
    ]);
    if (event.closedBy) people.delete(event.closedBy);
    await this.notifier.notify(
      store,
      [...people].map((userId) => claimClosed({ ...event, userId })),
      occurredAt,
    );
  }

  async contractReleased(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      accessorId: string;
    },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(
      store,
      [contractReleasedForAccessor(event)],
      occurredAt,
    );
  }

  /** The accessor and validators who have not left: nobody can open the contract any more. */
  async contractRevoked(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      reason: string;
      ownerId: string;
      accessorId: string | null;
      validatorIds: string[];
    },
    occurredAt?: string,
  ): Promise<void> {
    const people = event.accessorId
      ? [event.accessorId, ...event.validatorIds]
      : event.validatorIds;
    await this.notifier.notify(
      store,
      people.map((userId) => contractRevoked({ ...event, userId })),
      occurredAt,
    );
  }

  /** Those still named in a sealed envelope: when they may be asked to approve, or it may open for them, changed. */
  async contractRulesChanged(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      accessorId: string | null;
      validatorIds: string[];
      incapacityAllowed: boolean;
    },
    occurredAt?: string,
  ): Promise<void> {
    const people = event.accessorId
      ? [event.accessorId, ...event.validatorIds]
      : event.validatorIds;
    await this.notifier.notify(
      store,
      people.map((userId) => rulesChanged({ ...event, userId })),
      occurredAt,
    );
  }

  /** The owner: someone refused their role or deleted their account. */
  async participantLeft(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      participantId: string;
      role: string;
      reason: string;
    },
    occurredAt?: string,
  ): Promise<void> {
    await this.notifier.notify(store, [participantLeft(event)], occurredAt);
  }

  /** The gateway synced a profile: keep the address and name e-mails use (the latest one seen). */
  async userProfileChanged(
    store: NotifierStore,
    event: {
      userId: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
    },
    occurredAt?: string,
  ): Promise<void> {
    await store.people.save(
      event.userId,
      {
        email: event.email,
        firstName: event.firstName,
        lastName: event.lastName,
      },
      occurredAt ? new Date(occurredAt) : this.clock.now(),
    );
  }

  /** The account is gone: forget its notifications (and their e-mails), devices, settings, address. */
  async userDeleted(
    store: NotifierStore,
    userId: string,
    occurredAt?: string,
  ): Promise<void> {
    await store.notifications.deleteForUser(userId);
    await store.tokens.deleteForUser(userId);
    await store.preferences.deleteForUser(userId);
    await store.people.forget(
      userId,
      occurredAt ? new Date(occurredAt) : this.clock.now(),
    );
  }

  /**
   * Read notifications after 90 days; finished pushes and e-mails, and what is left of deleted
   * accounts, after 30.
   */
  async retention(store: NotifierStore): Promise<{
    notifications: number;
    deliveries: number;
    emails: number;
    forgotten: number;
  }> {
    const now = this.clock.now().getTime();
    const day = 86_400_000;
    return {
      notifications: await store.notifications.purgeRead(
        new Date(now - 90 * day),
      ),
      deliveries: await store.deliveries.purgeFinished(
        new Date(now - 30 * day),
      ),
      emails: await store.emails.purgeFinished(new Date(now - 30 * day)),
      forgotten: await store.people.purgeForgotten(new Date(now - 30 * day)),
    };
  }
}
