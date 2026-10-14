import { Inject, Injectable } from "@nestjs/common";
import {
  type ContractChanges,
  type ContractRecord,
  type AuditEvent,
  type ChainVerification,
  HANDOVER_AUDIENCE,
  type NewContract,
} from "@lib/contracts";
import { InternalHttpClient, type InternalHttpOptions } from "@lib/platform";
import type { HandoverClient } from "../application/handover-client.js";

export const HANDOVER_HTTP_OPTIONS = Symbol("HandoverHttpOptions");

/** Reads are retried once when handover is restarting; commands are not (they are not idempotent). */
@Injectable()
export class HttpHandoverClient implements HandoverClient {
  private readonly http: InternalHttpClient;

  constructor(
    @Inject(HANDOVER_HTTP_OPTIONS)
    options: Omit<InternalHttpOptions, "issuer" | "audience">,
  ) {
    this.http = new InternalHttpClient({
      ...options,
      issuer: "gateway",
      audience: HANDOVER_AUDIENCE,
    });
  }

  list(userId: string) {
    return this.http.call<ContractRecord[]>(userId, "GET", "/contracts", {
      idempotent: true,
    });
  }

  get(userId: string, id: string) {
    return this.http.call<ContractRecord>(userId, "GET", path(id), {
      idempotent: true,
    });
  }

  create(userId: string, contract: NewContract) {
    return this.http.call<ContractRecord>(userId, "POST", "/contracts", {
      body: contract,
      idempotent: false,
    });
  }

  update(userId: string, id: string, changes: ContractChanges) {
    return this.http.call<ContractRecord>(userId, "PATCH", path(id), {
      body: changes,
      idempotent: false,
    });
  }

  async remove(userId: string, id: string) {
    await this.http.call(userId, "DELETE", path(id), { idempotent: false });
  }

  events(userId: string, id: string) {
    return this.http.call<AuditEvent[]>(userId, "GET", `${path(id)}/events`, {
      idempotent: true,
    });
  }

  verify(userId: string, id: string) {
    return this.http.call<ChainVerification>(
      userId,
      "GET",
      `${path(id)}/events/verify`,
      { idempotent: true },
    );
  }
}

const path = (id: string) => `/contracts/${encodeURIComponent(id)}`;
