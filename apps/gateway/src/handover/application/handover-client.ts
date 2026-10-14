import type {
  AuditEvent,
  ChainVerification,
  ContractChanges,
  ContractRecord,
  NewContract,
} from "@lib/contracts";

/**
 * The handover service, which owns contracts, their life cycle and audit log. Every call is made
 * for one user: the authenticated caller, never a value from the request.
 */
export interface HandoverClient {
  list(userId: string): Promise<ContractRecord[]>;
  /** NotFoundError when the user takes no part in it. */
  get(userId: string, id: string): Promise<ContractRecord>;
  create(userId: string, contract: NewContract): Promise<ContractRecord>;
  update(
    userId: string,
    id: string,
    changes: ContractChanges,
  ): Promise<ContractRecord>;
  remove(userId: string, id: string): Promise<void>;
  events(userId: string, id: string): Promise<AuditEvent[]>;
  verify(userId: string, id: string): Promise<ChainVerification>;
}
export const HANDOVER_CLIENT = Symbol("HandoverClient");
