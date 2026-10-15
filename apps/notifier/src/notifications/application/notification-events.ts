import { Inject, Injectable } from "@nestjs/common";
import { type Clock } from "@lib/kernel";
import {
  contactKeysReset,
  keysReset,
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
