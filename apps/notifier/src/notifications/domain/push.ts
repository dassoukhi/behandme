import type { NotificationDraft } from "./notification.js";

/** What a phone receives (Expo push message without its recipient token). */
export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  /** App icon badge: the user's unread count once this notification is added. */
  badge: number;
  priority: "default" | "high";
  /** Android notification channel, created by the app. */
  channelId: "default" | "critical";
  interruptionLevel: "active" | "time-sensitive";
}

export function pushMessage(
  draft: NotificationDraft,
  notificationId: string,
  unreadCount: number,
): PushMessage {
  return {
    title: draft.title,
    body: draft.body,
    data: { ...draft.data, type: draft.type, notificationId },
    sound: "default",
    badge: unreadCount,
    priority: draft.critical ? "high" : "default",
    channelId: draft.critical ? "critical" : "default",
    interruptionLevel: draft.critical ? "time-sensitive" : "active",
  };
}

/** Expo's answer to a send (ticket) or, later, to a receipt request. */
export type PushOutcome =
  | { status: "ok"; id?: string }
  | { status: "error"; message: string; error?: string };

/** What to record for a delivery once Expo answered, and whether the device is gone. */
export function interpretOutcome(outcome: PushOutcome): {
  failed: boolean;
  error: string | null;
  deviceGone: boolean;
} {
  if (outcome.status === "ok") {
    return { failed: false, error: null, deviceGone: false };
  }
  return {
    failed: true,
    error: outcome.error ?? outcome.message,
    // The app was uninstalled or the token expired: never send to it again.
    deviceGone: outcome.error === "DeviceNotRegistered",
  };
}

/** Wait before retrying a send that failed `attempts` times: 30 s, 1 min, 2 min… up to 1 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
}

/** Sends tried this many times are given up. */
export const MAX_SEND_ATTEMPTS = 5;
