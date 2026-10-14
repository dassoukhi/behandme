// Internal HTTP API of the notifier, called by the gateway with an internal token whose subject
// is the user the request is for (libs/platform, internal-token.ts).

export const NOTIFIER_AUDIENCE = "notifier";

export interface InboxNotification {
  id: string;
  /** Kind of notification, e.g. "trust_added"; drives the icon and the wording in the app. */
  type: string;
  title: string;
  body: string;
  /** Includes `url`, the screen the app opens when the notification is tapped. */
  data: Record<string, unknown>;
  /** ISO 8601, null while unread. */
  read_at: string | null;
  created_at: string;
}

export interface UnreadCount {
  count: number;
}

export interface MarkedRead {
  updated: number;
}

export interface NotificationPreferences {
  /** Push for non-critical notifications; critical ones are always pushed. */
  push_enabled: boolean;
}

export interface PushTokenBody {
  token: string;
}

/** Most notifications returned by the inbox. */
export const INBOX_LIMIT = 100;
