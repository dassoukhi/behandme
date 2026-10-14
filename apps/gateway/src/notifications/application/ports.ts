import type {
  InboxNotification,
  MarkedRead,
  NotificationPreferences,
  UnreadCount,
} from "@lib/contracts";

/**
 * The notifier service, which owns notifications, push tokens and preferences. Every call is made
 * for one user: the id of the authenticated caller, never a value from the request.
 */
export interface NotifierClient {
  inbox(userId: string): Promise<InboxNotification[]>;
  unreadCount(userId: string): Promise<UnreadCount>;
  /** NotFoundError when the notification is not the user's. */
  markRead(
    userId: string,
    id: string,
    read: boolean,
  ): Promise<InboxNotification>;
  markAllRead(userId: string): Promise<MarkedRead>;
  /** NotFoundError when the notification is not the user's. */
  remove(userId: string, id: string): Promise<void>;
  registerPushToken(userId: string, token: string): Promise<void>;
  /** Only removes the token if it is the user's. */
  unregisterPushToken(userId: string, token: string): Promise<void>;
  preferences(userId: string): Promise<NotificationPreferences>;
  updatePreferences(
    userId: string,
    changes: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences>;
}
export const NOTIFIER_CLIENT = Symbol("NotifierClient");
