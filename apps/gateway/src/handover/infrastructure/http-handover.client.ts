import { Inject, Injectable } from "@nestjs/common";
import {
  type ContractChanges,
  type ContractRecord,
  type AuditEvent,
  type DecisionBody,
  type ChainVerification,
  HANDOVER_AUDIENCE,
  type NewContract,
  type RegisteredKeyRecord,
  type ReleasePackage,
  type SealedMaterial,
  type SealRequestBody,
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

  seal(
    userId: string,
    id: string,
    sealing: SealRequestBody,
    keys: RegisteredKeyRecord[],
  ) {
    return this.http.call<ContractRecord>(userId, "POST", `${path(id)}/seal`, {
      body: { ...sealing, registered_keys: keys },
      idempotent: false,
    });
  }

  sealed(userId: string, id: string) {
    return this.http.call<SealedMaterial>(userId, "GET", `${path(id)}/sealed`, {
      idempotent: true,
    });
  }

  revoke(userId: string, id: string, expectedVersion: number) {
    return this.http.call<ContractRecord>(
      userId,
      "POST",
      `${path(id)}/revoke`,
      {
        body: { expected_version: expectedVersion },
        idempotent: false,
      },
    );
  }

  fileClaim(userId: string, id: string) {
    return this.http.call<ContractRecord>(
      userId,
      "POST",
      `${path(id)}/claims`,
      {
        idempotent: false,
      },
    );
  }

  cancelClaim(userId: string, id: string, claimId: string) {
    return this.http.call<ContractRecord>(
      userId,
      "POST",
      `${claimPath(id, claimId)}/cancel`,
      { idempotent: false },
    );
  }

  withdrawClaim(userId: string, id: string, claimId: string) {
    return this.http.call<ContractRecord>(
      userId,
      "POST",
      `${claimPath(id, claimId)}/withdraw`,
      { idempotent: false },
    );
  }

  decide(
    userId: string,
    id: string,
    claimId: string,
    decision: DecisionBody,
    accessorKey: RegisteredKeyRecord | null,
  ) {
    return this.http.call<ContractRecord>(
      userId,
      "POST",
      `${claimPath(id, claimId)}/decision`,
      {
        body: {
          ...decision,
          ...(accessorKey ? { accessor_key: accessorKey } : {}),
        },
        idempotent: false,
      },
    );
  }

  release(userId: string, id: string) {
    return this.http.call<ReleasePackage>(
      userId,
      "GET",
      `${path(id)}/release`,
      {
        idempotent: true,
      },
    );
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
const claimPath = (id: string, claimId: string) =>
  `${path(id)}/claims/${encodeURIComponent(claimId)}`;
