import type {
  AuditEvent,
  ChainVerification,
  ContractChanges,
  ContractRecord,
  NewContract,
  RegisteredKeyRecord,
  SealedMaterial,
  SealRequestBody,
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
  /** `keys`: the current registered keys of the owner and of every participant (the gateway owns them). */
  seal(
    userId: string,
    id: string,
    sealing: SealRequestBody,
    keys: RegisteredKeyRecord[],
  ): Promise<ContractRecord>;
  /** What the user's role may have of the sealed contract. */
  sealed(userId: string, id: string): Promise<SealedMaterial>;
  revoke(
    userId: string,
    id: string,
    expectedVersion: number,
  ): Promise<ContractRecord>;
  events(userId: string, id: string): Promise<AuditEvent[]>;
  verify(userId: string, id: string): Promise<ChainVerification>;
}
export const HANDOVER_CLIENT = Symbol("HandoverClient");
