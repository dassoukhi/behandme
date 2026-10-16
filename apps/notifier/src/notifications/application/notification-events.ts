import { Inject, Injectable } from "@nestjs/common";
import { type Clock } from "@lib/kernel";
import {
  claimClosed,
  claimFiledForOwner,
  claimFiledForValidator,
  claimQuorumReached,
  claimReminderForOwner,
  claimReminderForValidator,
  contactKeysReset,
  contractReleasedForAccessor,
  contractRevoked,
  keysReset,
  participantLeft,
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
  ): Promise<void> {
    await this.notifier.notify(store, [
      trustAdded({
        userId: event.trustedId,
        ownerId: event.ownerId,
        ownerName: event.ownerName,
      }),
    ]);
  }

  /** Alert the user (it may not have been them), and tell the people who may encrypt to them. */
  async keysRotated(
    store: NotifierStore,
    event: { userId: string; userName: string | null; trusterIds: string[] },
  ): Promise<void> {
    await this.notifier.notify(store, [
      keysReset({ userId: event.userId }),
      ...event.trusterIds.map((trusterId) =>
        contactKeysReset({
          trusterId,
          userId: event.userId,
          userName: event.userName,
        }),
      ),
    ]);
  }

  /** Alert the owner (they may stop it), ask the other validators for their decision. */
  async claimFiled(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      claimantId: string;
      validatorIds: string[];
    },
  ): Promise<void> {
    await this.notifier.notify(store, [
      claimFiledForOwner(event),
      ...event.validatorIds
        .filter((id) => id !== event.claimantId)
        .map((validatorId) =>
          claimFiledForValidator({ ...event, validatorId }),
        ),
    ]);
  }

  async claimQuorumReached(
    store: NotifierStore,
    event: { contractId: string; category: string; ownerId: string },
  ): Promise<void> {
    await this.notifier.notify(store, [claimQuorumReached(event)]);
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
    },
  ): Promise<void> {
    await this.notifier.notify(store, [
      claimReminderForOwner(event),
      ...event.pendingValidatorIds.map((validatorId) =>
        claimReminderForValidator({ ...event, validatorId }),
      ),
    ]);
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
    );
  }

  async contractReleased(
    store: NotifierStore,
    event: { contractId: string; category: string; accessorId: string },
  ): Promise<void> {
    await this.notifier.notify(store, [contractReleasedForAccessor(event)]);
  }

  /** The accessor and validators: nobody can open the contract any more. */
  async contractRevoked(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      reason: string;
      accessorId: string;
      validatorIds: string[];
    },
  ): Promise<void> {
    await this.notifier.notify(
      store,
      [event.accessorId, ...event.validatorIds].map((userId) =>
        contractRevoked({ ...event, userId }),
      ),
    );
  }

  async participantLeft(
    store: NotifierStore,
    event: {
      contractId: string;
      category: string;
      ownerId: string;
      role: string;
    },
  ): Promise<void> {
    await this.notifier.notify(store, [participantLeft(event)]);
  }

  /** The account is gone: forget its notifications, devices and settings. */
  async userDeleted(store: NotifierStore, userId: string): Promise<void> {
    await store.notifications.deleteForUser(userId);
    await store.tokens.deleteForUser(userId);
    await store.preferences.deleteForUser(userId);
  }

  /** Read notifications after 90 days, finished deliveries after 30. */
  async retention(
    store: NotifierStore,
  ): Promise<{ notifications: number; deliveries: number }> {
    const now = this.clock.now().getTime();
    const day = 86_400_000;
    return {
      notifications: await store.notifications.purgeRead(
        new Date(now - 90 * day),
      ),
      deliveries: await store.deliveries.purgeFinished(
        new Date(now - 30 * day),
      ),
    };
  }
}
