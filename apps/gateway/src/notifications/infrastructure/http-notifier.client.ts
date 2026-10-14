import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type InboxNotification,
  type MarkedRead,
  NOTIFIER_AUDIENCE,
  type NotificationPreferences,
  type UnreadCount,
} from "@lib/contracts";
import {
  ConflictError,
  currentCorrelationId,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";
import { CORRELATION_HEADER, signInternalToken } from "@lib/platform";
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

const RETRYABLE = new Set([502, 503, 504]);

/**
 * Calls the notifier's internal API with a token that names the user. Every call but deleting a
 * notification is idempotent, so it is retried once when the notifier is unreachable or restarting.
 */
@Injectable()
export class HttpNotifierClient implements NotifierClient {
  constructor(
    @Inject(NOTIFIER_HTTP_OPTIONS)
    private readonly options: NotifierHttpOptions,
  ) {}

  inbox(userId: string) {
    return this.call<InboxNotification[]>(userId, "GET", "/inbox");
  }

  unreadCount(userId: string) {
    return this.call<UnreadCount>(userId, "GET", "/inbox/unread-count");
  }

  markRead(userId: string, id: string, read: boolean) {
    return this.call<InboxNotification>(
      userId,
      "PATCH",
      `/inbox/${encodeURIComponent(id)}`,
      { read },
    );
  }

  markAllRead(userId: string) {
    return this.call<MarkedRead>(userId, "POST", "/inbox/read-all");
  }

  async remove(userId: string, id: string) {
    await this.call(
      userId,
      "DELETE",
      `/inbox/${encodeURIComponent(id)}`,
      undefined,
      {
        retry: false,
      },
    );
  }

  async registerPushToken(userId: string, token: string) {
    await this.call(userId, "POST", "/push-tokens", { token });
  }

  async unregisterPushToken(userId: string, token: string) {
    await this.call(userId, "POST", "/push-tokens/unregister", { token });
  }

  preferences(userId: string) {
    return this.call<NotificationPreferences>(userId, "GET", "/preferences");
  }

  updatePreferences(userId: string, changes: Partial<NotificationPreferences>) {
    return this.call<NotificationPreferences>(
      userId,
      "PATCH",
      "/preferences",
      changes,
    );
  }

  private async call<T>(
    userId: string,
    method: string,
    path: string,
    body?: unknown,
    { retry = true } = {},
  ): Promise<T> {
    const { baseUrl, secret, timeoutMs = 5000 } = this.options;
    const fetchFn = this.options.fetch ?? fetch;
    const attempt = async () =>
      fetchFn(`${baseUrl.replace(/\/$/, "")}/internal/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await signInternalToken(secret, {
            issuer: "gateway",
            audience: NOTIFIER_AUDIENCE,
            userId,
          })}`,
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(currentCorrelationId() && {
            [CORRELATION_HEADER]: currentCorrelationId(),
          }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

    let response: Response;
    try {
      response = await attempt();
      if (retry && RETRYABLE.has(response.status)) response = await attempt();
    } catch (error) {
      if (!retry) throw unavailable(error);
      try {
        response = await attempt();
      } catch (again) {
        throw unavailable(again);
      }
    }

    if (response.ok) {
      return (response.status === 204 ? undefined : await response.json()) as T;
    }
    const message = await errorMessage(response);
    switch (response.status) {
      case 400:
        throw new InvalidInputError(message);
      case 404:
        throw new NotFoundError(message);
      case 409:
        throw new ConflictError(message);
      case 422:
        throw new UnprocessableError(message);
      default:
        if (response.status >= 500) throw unavailable(message);
        throw new Error(`Notifier answered ${response.status}: ${message}`);
    }
  }
}

function unavailable(cause: unknown): ServiceUnavailableException {
  return new ServiceUnavailableException("Notifications are unavailable", {
    cause,
  });
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return Array.isArray(body.message)
      ? body.message.join(", ")
      : String(body.message ?? response.statusText);
  } catch {
    return response.statusText;
  }
}
