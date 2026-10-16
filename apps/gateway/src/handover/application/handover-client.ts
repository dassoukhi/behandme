import type {
  AuditEvent,
  ChainVerification,
  ContractChanges,
  ContractRecord,
  DecisionBody,
  NewContract,
  RegisteredKeyRecord,
  ReleasePackage,
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
  /** The accessor or a validator asks for the release. */
  fileClaim(userId: string, id: string): Promise<ContractRecord>;
  cancelClaim(
    userId: string,
    id: string,
    claimId: string,
  ): Promise<ContractRecord>;
  withdrawClaim(
    userId: string,
    id: string,
    claimId: string,
  ): Promise<ContractRecord>;
  /** `accessorKey`: the accessor's current registered keys, to check an approval against. */
  decide(
    userId: string,
    id: string,
    claimId: string,
    decision: DecisionBody,
    accessorKey: RegisteredKeyRecord | null,
  ): Promise<ContractRecord>;
  /** The accessor's download once released. */
  release(userId: string, id: string): Promise<ReleasePackage>;
  events(userId: string, id: string): Promise<AuditEvent[]>;
  verify(userId: string, id: string): Promise<ChainVerification>;
}
export const HANDOVER_CLIENT = Symbol("HandoverClient");
