import { ApiProperty } from "@nestjs/swagger";
import {
  CONTRACT_CATEGORIES,
  CONTRACT_STATUSES,
  type AuditEvent,
  type ChainVerification,
  type ContractAction,
  type ContractCategory,
  type ContractRole,
  type ContractStatus,
} from "@lib/contracts";
import { UserProfileDto } from "../../../users/interface/dto/user-profile.dto.js";

const ROLES: ContractRole[] = ["owner", "accessor", "validator"];
const ACTIONS: ContractAction[] = ["update", "delete"];

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
