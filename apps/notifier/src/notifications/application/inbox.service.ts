import { Inject, Injectable } from "@nestjs/common";
import { INBOX_LIMIT, type InboxNotification } from "@lib/contracts";
import { type Clock, NotFoundError } from "@lib/kernel";
import type { Preferences } from "../domain/notification.js";
import {
  CLOCK,
  NOTIFIER_STORES,
  type NotifierStores,
  type StoredNotification,
} from "./ports.js";

/** What a user does with their own notifications, devices and settings (internal API). */
@Injectable()
export class InboxService {
  constructor(
    @Inject(NOTIFIER_STORES) private readonly stores: NotifierStores,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get store() {
    return this.stores.root;
  }

  async list(userId: string): Promise<InboxNotification[]> {
    return (await this.store.notifications.list(userId, INBOX_LIMIT)).map(
      toInbox,
    );
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const counts = await this.store.notifications.unreadCounts([userId]);
    return { count: counts.get(userId) ?? 0 };
  }

  async setRead(
    userId: string,
    id: string,
    read: boolean,
  ): Promise<InboxNotification> {
    const notification = await this.store.notifications.setRead(
      userId,
      id,
      read,
      this.clock.now(),
    );
    if (!notification) throw new NotFoundError("Notification not found");
    return toInbox(notification);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    return {
      updated: await this.store.notifications.markAllRead(
        userId,
        this.clock.now(),
      ),
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.store.notifications.delete(userId, id))) {
      throw new NotFoundError("Notification not found");
    }
  }

  registerDevice(userId: string, token: string): Promise<void> {
    return this.store.tokens.register(userId, token);
  }

  unregisterDevice(userId: string, token: string): Promise<void> {
    return this.store.tokens.unregister(userId, token);
  }

  async preferences(userId: string): Promise<Preferences> {
    return (await this.store.preferences.getMany([userId])).get(userId)!;
  }

  updatePreferences(
    userId: string,
    changes: Partial<Preferences>,
  ): Promise<Preferences> {
    return this.store.preferences.update(userId, changes);
  }
}

/** What the user sees: every field but the owner (an explicit list, so a new column stays private). */
function toInbox(notification: StoredNotification): InboxNotification {
  const { id, type, title, body, data, read_at, created_at } = notification;
  return { id, type, title, body, data, read_at, created_at };
}
