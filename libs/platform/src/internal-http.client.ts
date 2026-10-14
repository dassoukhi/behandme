import { ServiceUnavailableException } from "@nestjs/common";
import {
  ConflictError,
  currentCorrelationId,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";
import { CORRELATION_HEADER } from "./correlation.middleware.js";
import { signInternalToken } from "./internal-token.js";

export interface InternalHttpOptions {
  /** e.g. http://notifier.railway.internal:3001 */
  baseUrl: string;
  /** INTERNAL_JWT_SECRET, shared by the services. */
  secret: string;
  /** This service's name (token issuer). */
  issuer: string;
  /** The called service's name (token audience). */
  audience: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const RETRYABLE = new Set([502, 503, 504]);

/**
 * Calls another service's internal API (`/internal/v1/*`) for a user, with a short-lived internal
 * token that names them and the request's correlation id. Errors come back as the kernel errors
 * (400, 404, 409, 422) or as 503 when the service is unreachable. Calls marked idempotent are
 * retried once when the service is unreachable or restarting.
 */
export class InternalHttpClient {
  constructor(private readonly options: InternalHttpOptions) {}

  async call<T>(
    userId: string | null,
    method: string,
    path: string,
    { body, idempotent }: { body?: unknown; idempotent: boolean },
  ): Promise<T> {
    const {
      baseUrl,
      secret,
      issuer,
      audience,
      timeoutMs = 5000,
    } = this.options;
    const fetchFn = this.options.fetch ?? fetch;
    const attempt = async () =>
      fetchFn(`${baseUrl.replace(/\/$/, "")}/internal/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await signInternalToken(secret, {
            issuer,
            audience,
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
      if (idempotent && RETRYABLE.has(response.status)) {
        response = await attempt();
      }
    } catch (error) {
      if (!idempotent) throw this.unavailable(error);
      try {
        response = await attempt();
      } catch (again) {
        throw this.unavailable(again);
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
        if (response.status >= 500) throw this.unavailable(message);
        throw new Error(`${audience} answered ${response.status}: ${message}`);
    }
  }

  private unavailable(cause: unknown): ServiceUnavailableException {
    return new ServiceUnavailableException(
      `The ${this.options.audience} service is unavailable`,
      { cause },
    );
  }
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
