import { ApiProperty } from "@nestjs/swagger";
import {
  CLAIM_STATUSES,
  CONTRACT_CATEGORIES,
  CONTRACT_STATUSES,
  type AuditEvent,
  type ChainVerification,
  type ClaimRecord,
  type ClaimStatus,
  type ContractAction,
  type ContractCategory,
  type ContractRole,
  type ContractStatus,
  type SealedMaterial,
} from "@lib/contracts";
import { PublicKeysDto } from "../../../keys/interface/dto/keys.dto.js";
import { UserProfileDto } from "../../../users/interface/dto/user-profile.dto.js";

const ROLES: ContractRole[] = ["owner", "accessor", "validator"];
const ACTIONS: ContractAction[] = [
  "update",
  "delete",
  "seal",
  "revoke",
  "claim",
  "cancel_claim",
  "withdraw_claim",
  "decide",
  "open",
];

/** The claim in progress on a contract. */
export class ClaimDTO implements ClaimRecord {
  @ApiProperty({ example: "9b0c2d4e-6f71-4a83-b5c6-d7e8f9a0b1c2" })
  id: string;

  @ApiProperty({ description: "Who asked for the release" })
  claimant_id: string;

  @ApiProperty({ enum: CLAIM_STATUSES })
  status: ClaimStatus;

  @ApiProperty({ example: "2026-10-16T09:00:00.000Z" })
  filed_at: string;

  @ApiProperty({
    description:
      "The owner may cancel until then; the release needs this date and enough approvals",
    example: "2026-10-23T09:00:00.000Z",
  })
  contest_until: string;

  @ApiProperty({
    description: "Without enough approvals, the claim ends then",
    example: "2026-12-15T09:00:00.000Z",
  })
  expires_at: string;

  @ApiProperty({ example: 1 })
  approvals: number;

  @ApiProperty({ example: 0 })
  rejections: number;

  @ApiProperty({ description: "Approvals needed (k of n)", example: 2 })
  threshold: number;

  @ApiProperty({
    description: "The caller's decision, when they are a validator who decided",
    enum: ["approve", "reject"],
    nullable: true,
    type: String,
  })
  my_decision: "approve" | "reject" | null;
}

/** How many validators could still approve a claim: their keys are those the contract was sealed for. */
export class HealthDTO {
  @ApiProperty({ example: 3 })
  usable: number;

  @ApiProperty({ example: 3 })
  total: number;

  @ApiProperty({ description: "Approvals needed (k of n)", example: 2 })
  threshold: number;
}

// A contract as one of its participants sees it. Secret material is never returned.
export class ContractDTO {
  @ApiProperty({ example: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5" })
  id: string;

  @ApiProperty({ enum: CONTRACT_CATEGORIES, example: "networks" })
  category: ContractCategory;

  @ApiProperty({
    description: "Short description visible to every participant",
    nullable: true,
    type: String,
    example: "Accès à mes réseaux sociaux",
  })
  description: string | null;

  @ApiProperty({
    description:
      "draft (not sealed yet) → active → claimed → released; revoked. Changed only by actions.",
    enum: CONTRACT_STATUSES,
  })
  status: ContractStatus;

  @ApiProperty({ description: "Bumped by every change", example: 1 })
  version: number;

  @ApiProperty({
    description: "Number of the current sealing; 0 while a draft",
    example: 0,
  })
  sealed_version: number;

  @ApiProperty({ example: "user_2abcdefghijklmnop" })
  owner_id: string;

  @ApiProperty({ example: "user_2qrstuvwxyz123456" })
  accessor_id: string;

  @ApiProperty({
    description: "Validator ids, in order",
    type: [String],
    example: ["user_2aaaaaaaaaaaaaaa"],
  })
  validator_ids: string[];

  @ApiProperty({ example: "2026-10-12T07:20:50.520Z" })
  created_at: string;

  @ApiProperty({ example: "2026-10-15T09:30:50.520Z" })
  updated_at: string;

  @ApiProperty({ description: "The caller's role", enum: ROLES })
  my_role: ContractRole;

  @ApiProperty({
    description:
      "What the caller may do now; the app shows only these actions (rules live in the backend)",
    enum: ACTIONS,
    isArray: true,
  })
  allowed_actions: ContractAction[];

  @ApiProperty({
    description: "Days the owner has to cancel a claim (3 to 30)",
    example: 7,
  })
  contest_days: number;

  @ApiProperty({
    description: "The claim in progress; null when there is none",
    type: () => ClaimDTO,
    nullable: true,
  })
  open_claim: ClaimDTO | null;

  @ApiProperty({
    description:
      "After the owner cancelled the caller's last claim, they may claim again only from then; null otherwise",
    nullable: true,
    type: String,
  })
  claim_cooldown_until: string | null;

  @ApiProperty({
    description:
      "Validators whose keys are still those the contract was sealed for; null while never sealed",
    type: () => HealthDTO,
    nullable: true,
  })
  health: HealthDTO | null;

  @ApiProperty({
    description: "Owner profile; null if it no longer exists",
    type: () => UserProfileDto,
    nullable: true,
  })
  owner: UserProfileDto | null;

  @ApiProperty({
    description: "Accessor profile; null if it no longer exists",
    type: () => UserProfileDto,
    nullable: true,
  })
  accessor: UserProfileDto | null;
}

export class ContractDetailDTO extends ContractDTO {
  @ApiProperty({
    description: "Validator profiles, in the order of `validator_ids`",
    type: () => [UserProfileDto],
  })
  validators_list: UserProfileDto[];
}

export class ContractEventDTO implements AuditEvent {
  @ApiProperty({
    description: "Position in the contract's log, from 1",
    example: 1,
  })
  seq: number;

  @ApiProperty({ example: "contract.created" })
  type: string;

  @ApiProperty({
    description: "Who did it; null for the system",
    nullable: true,
    type: String,
    example: "user_2abcdefghijklmnop",
  })
  actor_id: string | null;

  @ApiProperty({
    description: "Canonical JSON (RFC 8785) of the details, exactly as hashed",
    example: '{"fields":["description"]}',
  })
  body: string;

  @ApiProperty({
    description: "ISO 8601 with milliseconds, exactly as hashed",
    example: "2026-10-14T20:24:32.238Z",
  })
  occurred_at: string;

  @ApiProperty({
    description: "Hash of the previous event (64 zeros for the first)",
  })
  prev_hash: string;

  @ApiProperty({
    description:
      "hex SHA-256 of prev_hash, seq, occurred_at, contract id, type, actor_id ('' if null) and body, joined by \\n",
  })
  hash: string;
}

export class ChainVerificationDTO implements ChainVerification {
  @ApiProperty({ description: "True when every event verifies" })
  ok: boolean;

  @ApiProperty({ description: "Number of events", example: 3 })
  length: number;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "Hash of the last event",
  })
  head_hash: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: "First seq that does not verify",
  })
  broken_at: number | null;
}

class SealedShareDTO {
  @ApiProperty({ example: 1 })
  index: number;

  @ApiProperty({ example: 1 })
  key_version: number;

  @ApiProperty({ description: "The share wrapped to the caller, base64" })
  wrap: string;
}

/** What the caller's role may have of a sealed contract. */
export class SealedMaterialDTO implements SealedMaterial {
  @ApiProperty({ example: 1 })
  sealed_version: number;

  @ApiProperty({
    description: "The manifest the owner signed",
    type: "object",
    additionalProperties: true,
  })
  manifest: Record<string, unknown>;

  @ApiProperty({
    description: "The owner's Ed25519 signature of the manifest, base64",
  })
  manifest_signature: string;

  @ApiProperty({
    description: "Owner only: the encrypted secret, base64",
    required: false,
  })
  envelope?: string;

  @ApiProperty({
    description: "Owner only: the contract key wrapped to them, base64",
    required: false,
  })
  owner_wrap?: string;

  @ApiProperty({
    description: "Validator only: their share",
    required: false,
    type: () => SealedShareDTO,
  })
  share?: SealedShareDTO;

  @ApiProperty({
    description:
      "The owner's keys that signed the manifest (current or retired): check the signature with them",
    type: () => PublicKeysDto,
    nullable: true,
  })
  owner_keys: PublicKeysDto | null;

  @ApiProperty({
    description:
      "Validator only: the accessor's current keys, to re-wrap the share for them when approving",
    type: () => PublicKeysDto,
    nullable: true,
    required: false,
  })
  accessor_keys?: PublicKeysDto | null;
}

class ReleasedShareDTO {
  @ApiProperty({ example: 1 })
  index: number;

  @ApiProperty({
    description: "The accessor key version it is wrapped to",
    example: 1,
  })
  key_version: number;

  @ApiProperty({ description: "The share wrapped to the accessor, base64" })
  wrap: string;
}

/** What the accessor downloads once the contract is released. */
export class ReleasePackageDTO {
  @ApiProperty({ example: 1 })
  sealed_version: number;

  @ApiProperty({
    description: "The manifest the owner signed",
    type: "object",
    additionalProperties: true,
  })
  manifest: Record<string, unknown>;

  @ApiProperty({ description: "The owner's signature of the manifest, base64" })
  manifest_signature: string;

  @ApiProperty({ description: "The encrypted secret, base64" })
  envelope: string;

  @ApiProperty({ description: "The claim that released the contract" })
  claim_id: string;

  @ApiProperty({
    description: "At least k shares, wrapped to the accessor",
    type: () => [ReleasedShareDTO],
  })
  shares: ReleasedShareDTO[];

  @ApiProperty({
    description: "The owner's keys that signed the manifest",
    type: () => PublicKeysDto,
    nullable: true,
  })
  owner_keys: PublicKeysDto | null;
}
