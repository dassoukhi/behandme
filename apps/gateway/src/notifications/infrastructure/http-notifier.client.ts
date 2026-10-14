import { Inject, Injectable } from "@nestjs/common";
import {
  type InboxNotification,
  type MarkedRead,
  NOTIFIER_AUDIENCE,
  type NotificationPreferences,
  type UnreadCount,
} from "@lib/contracts";
import { InternalHttpClient } from "@lib/platform";
import type { NotifierClient } from "../application/ports.js";

export interface NotifierHttpOptions {
  /** e.g. http://notifier.railway.internal:3001 */
  baseUrl: string;
  /** INTERNAL_JWT_SECRET, shared with the notifier. */
  secret: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export const NOTIFIER_HTTP_OPTIONS = Symbol("NotifierHttpOptions");

/**
 * The notifier's internal API, for the authenticated caller. Every call but deleting a notification
 * is idempotent, so it is retried once when the notifier is unreachable or restarting.
 */
@Injectable()
export class HttpNotifierClient implements NotifierClient {
  private readonly http: InternalHttpClient;

  constructor(@Inject(NOTIFIER_HTTP_OPTIONS) options: NotifierHttpOptions) {
    this.http = new InternalHttpClient({
      ...options,
      issuer: "gateway",
      audience: NOTIFIER_AUDIENCE,
    });
  }

  inbox(userId: string) {
    return this.http.call<InboxNotification[]>(userId, "GET", "/inbox", {
      idempotent: true,
    });
  }

  unreadCount(userId: string) {
    return this.http.call<UnreadCount>(userId, "GET", "/inbox/unread-count", {
      idempotent: true,
    });
  }

  markRead(userId: string, id: string, read: boolean) {
    return this.http.call<InboxNotification>(
      userId,
      "PATCH",
      `/inbox/${encodeURIComponent(id)}`,
      { body: { read }, idempotent: true },
    );
  }

  markAllRead(userId: string) {
    return this.http.call<MarkedRead>(userId, "POST", "/inbox/read-all", {
      idempotent: true,
    });
  }

  async remove(userId: string, id: string) {
    await this.http.call(userId, "DELETE", `/inbox/${encodeURIComponent(id)}`, {
      idempotent: false,
    });
  }

  async registerPushToken(userId: string, token: string) {
    await this.http.call(userId, "POST", "/push-tokens", {
      body: { token },
      idempotent: true,
    });
  }

  async unregisterPushToken(userId: string, token: string) {
    await this.http.call(userId, "POST", "/push-tokens/unregister", {
      body: { token },
      idempotent: true,
    });
  }

  preferences(userId: string) {
    return this.http.call<NotificationPreferences>(
      userId,
      "GET",
      "/preferences",
      { idempotent: true },
    );
  }

  updatePreferences(userId: string, changes: Partial<NotificationPreferences>) {
    return this.http.call<NotificationPreferences>(
      userId,
      "PATCH",
      "/preferences",
      { body: changes, idempotent: true },
    );
  }
}
