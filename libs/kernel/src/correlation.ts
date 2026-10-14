import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Id shared by every log line, request and event that follows from one user action, so a flow can
 * be traced across services. Set at the edge (HTTP request, received event), read anywhere below.
 */
const storage = new AsyncLocalStorage<{ correlationId: string }>();

export function withCorrelation<T>(correlationId: string, work: () => T): T {
  return storage.run({ correlationId }, work);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
