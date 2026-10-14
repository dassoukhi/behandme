import { Inject, Injectable } from "@nestjs/common";
import type { Clock } from "@lib/kernel";
import {
  DEFAULT_PREFERENCES,
  type NotificationDraft,
  shouldPush,
} from "../domain/notification.js";
import { pushMessage } from "../domain/push.js";
import { CLOCK, type NotifierStore } from "./ports.js";

/**
 * Creates notifications: the inbox rows, and a push delivery per device of each recipient who
 * should be pushed. Runs inside the caller's transaction; pushes leave after it commits
 * (DeliveryService), so a rolled-back event sends nothing.
 */
@Injectable()
export class NotifyService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  async notify(
    store: NotifierStore,
    drafts: NotificationDraft[],
  ): Promise<void> {
    if (drafts.length === 0) return;
    const userIds = [...new Set(drafts.map((d) => d.userId))];
    const stored = await store.notifications.insert(drafts);
    const [preferences, tokens, unread] = await Promise.all([
      store.preferences.getMany(userIds),
      store.tokens.tokensOf(userIds),
      store.notifications.unreadCounts(userIds),
    ]);

    const deliveries = drafts.flatMap((draft, i) => {
      const prefs = preferences.get(draft.userId) ?? DEFAULT_PREFERENCES;
      if (!shouldPush(draft, prefs)) return [];
      const message = pushMessage(
        draft,
        stored[i].id,
        unread.get(draft.userId) ?? 0,
      );
      return (tokens.get(draft.userId) ?? []).map((token) => ({
        notificationId: stored[i].id,
        token,
        message,
      }));
    });
    await store.deliveries.enqueue(deliveries, this.clock.now());
  }
}
