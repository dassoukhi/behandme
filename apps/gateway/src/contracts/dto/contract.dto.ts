import { ApiProperty } from "@nestjs/swagger";
import { UserProfileDto } from "../../users/dto/user-profile.dto.js";
import {
  CONTRACT_CATEGORIES,
  type ContractCategory,
} from "./create-contract.dto.js";

export const CONTRACT_STATUSES = [
  "draft",
  "active",
  "validated",
  "released",
  "revoked",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

// Public shape of a contract. Secret material and legacy blockchain fields are
// never returned (they are dropped from the schema in later migrations).
export class ContractDTO {
  @ApiProperty({ example: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5" })
  id: string;

  @ApiProperty({ enum: CONTRACT_CATEGORIES, example: "networks" })
  name: ContractCategory;

  @ApiProperty({
    description: "Short description visible to every participant",
    nullable: true,
    example: "Accès à mes réseaux sociaux",
  })
  description: string | null;

  @ApiProperty({ example: "user_2abcdefghijklmnop" })
  owner_id: string;

  @ApiProperty({ nullable: true, example: "user_2qrstuvwxyz123456" })
  accessor_id: string | null;

  @ApiProperty({ type: [String], example: ["user_2aaaaaaaaaaaaaaa"] })
  validators: string[];

  @ApiProperty({
    description: "Lifecycle status, changed only by dedicated actions",
    enum: CONTRACT_STATUSES,
    nullable: true,
  })
  status: ContractStatus | null;

  @ApiProperty({ nullable: true, example: "2026-10-12T07:20:50.52Z" })
  created_at: string | null;

  @ApiProperty({ nullable: true, example: "2026-10-15T09:30:50.52Z" })
  updated_at: string | null;

  @ApiProperty({
    description: "Owner profile (joined on list and detail endpoints)",
    type: () => UserProfileDto,
    required: false,
    nullable: true,
  })
  owner?: UserProfileDto | null;

  @ApiProperty({
    description: "Accessor profile (joined on list and detail endpoints)",
    type: () => UserProfileDto,
    required: false,
    nullable: true,
  })
  accessor?: UserProfileDto | null;
}
