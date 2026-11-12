import { Inject, Injectable } from "@nestjs/common";
import type { Clock } from "@lib/kernel";
import {
  deliverableAddress,
  emailContent,
  emailContext,
  emailKind,
  ONCE_A_DAY_TYPES,
  REGULAR_EMAILS_PER_DAY,
  shouldEmail,
} from "../domain/email.js";
import {
  DEFAULT_PREFERENCES,
  type NotificationDraft,
  render,
  shouldPush,
} from "../domain/notification.js";
import { pushMessage } from "../domain/push.js";
import {
  CLOCK,
  EMAIL_GATEWAY,
  type EmailGateway,
  type NotifierStore,
} from "./ports.js";

/**
 * Creates notifications: the inbox rows, a push delivery per device of each recipient who should be
 * pushed, and an e-mail for each one who should be e-mailed. Runs inside the caller's transaction; pushes
 * and e-mails leave after it commits (DeliveryService, EmailDeliveryService), so a rolled-back event sends
 * nothing.
 */
@Injectable()
export class NotifyService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
  ) {}

  /** @param occurredAt when the event happened (ISO 8601), which e-mails may say; now by default. */
  async notify(
    store: NotifierStore,
    drafts: NotificationDraft[],
    occurredAt?: string,
  ): Promise<void> {
    if (drafts.length === 0) return;
    const now = this.clock.now();
    const userIds = [...new Set(drafts.map((d) => d.userId))];
    const preferences = await store.preferences.getMany(userIds);
    const prefsOf = (userId: string) =>
      preferences.get(userId) ?? DEFAULT_PREFERENCES;
    const rendered = drafts.map((draft) =>
      render(draft, prefsOf(draft.userId).language),
    );
    const stored = await store.notifications.insert(rendered);
    // After the insert: the badge counts the notification just added.
    const [tokens, unread] = await Promise.all([
      store.tokens.tokensOf(userIds),
      store.notifications.unreadCounts(userIds),
    ]);

    const deliveries = rendered.flatMap((notification, i) => {
      if (!shouldPush(notification, prefsOf(notification.userId))) return [];
      const message = pushMessage(
        notification,
        stored[i].id,
        unread.get(notification.userId) ?? 0,
      );
      return (tokens.get(notification.userId) ?? []).map((token) => ({
        notificationId: stored[i].id,
        token,
        message,
      }));
    });
    await store.deliveries.enqueue(deliveries, now);

    // Without a provider, nothing is queued: a key added later must not send old e-mails.
    if (!this.email.enabled) return;
    const emailed = rendered
      .map((notification, i) => ({ notification, draft: drafts[i], i }))
      .filter(({ notification }) =>
        shouldEmail(notification, prefsOf(notification.userId)),
      );
    if (emailed.length === 0) return;
    const [people, recent] = await Promise.all([
      store.people.getMany([
        ...new Set([
          ...emailed.map((e) => e.notification.userId),
          ...emailed.flatMap((e) => e.draft.mentions ?? []),
        ]),
      ]),
      store.emails.recentRegular(
        [...new Set(emailed.map((e) => e.notification.userId))],
        new Date(now.getTime() - DAY_MS),
      ),
    ]);
    // Critical alerts always go; the others are throttled per person (REGULAR_EMAILS_PER_DAY).
    const throttled = (notification: (typeof rendered)[number]) => {
      if (notification.critical) return false;
      const sent = recent.get(notification.userId) ?? {
        count: 0,
        kinds: new Set<string>(),
      };
      const kind = emailKind(notification.type, notification.data.url);
      const repeated =
        ONCE_A_DAY_TYPES.has(notification.type) && sent.kinds.has(kind);
      if (sent.count >= REGULAR_EMAILS_PER_DAY || repeated) return true;
      sent.count++;
      sent.kinds.add(kind);
      recent.set(notification.userId, sent);
      return false;
    };
    const when = occurredAt ?? now.toISOString();
    const emails = emailed.flatMap(({ notification, draft, i }) => {
      const recipient = people.get(notification.userId);
      if (!recipient?.email || !deliverableAddress(recipient.email)) return [];
      if (throttled(notification)) return [];
      const prefs = prefsOf(notification.userId);
      const context = emailContext(people, prefs.time_zone, when);
      return [
        {
          notificationId: stored[i].id,
          to: recipient.email,
          content: emailContent(
            notification,
            draft.email,
            context,
            recipient.firstName,
            prefs.language,
          ),
        },
      ];
    });
    await store.emails.enqueue(emails, now);
  }
}

const DAY_MS = 86_400_000;
