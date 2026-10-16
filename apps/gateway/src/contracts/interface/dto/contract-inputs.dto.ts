import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBase64,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { CONTRACT_CATEGORIES, type ContractCategory } from "@lib/contracts";

// The owner is the authenticated caller. Status and every life-cycle field are changed by handover
// only, never accepted from the client.
export class CreateContractDTO {
  @ApiProperty({ enum: CONTRACT_CATEGORIES, example: "networks" })
  @IsIn(CONTRACT_CATEGORIES)
  category: ContractCategory;

  @ApiPropertyOptional({
    description:
      "Short description visible to every participant: never put anything secret here",
    maxLength: 280,
    nullable: true,
    type: String,
    example: "Accès à mes réseaux sociaux",
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string | null;

  @ApiProperty({
    description: "Clerk ID of the accessor (must be someone the caller trusts)",
    example: "user_2qrstuvwxyz123456",
  })
  @IsString()
  @IsNotEmpty()
  accessor_id: string;

  @ApiProperty({
    description:
      "Clerk IDs of 1 to 3 distinct validators (people the caller trusts), in order",
    type: [String],
    minItems: 1,
    maxItems: 3,
    example: ["user_2aaaaaaaaaaaaaaa", "user_2bbbbbbbbbbbbbbb"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  validator_ids: string[];

  @ApiPropertyOptional({
    description:
      "Days the owner has to cancel a claim before a release (3 to 30, 7 by default)",
    minimum: 3,
    maximum: 30,
    example: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(30)
  contest_days?: number;
}

// Descriptive fields and the contest window; participants change by re-sealing.
export class UpdateContractDTO {
  @ApiPropertyOptional({ enum: CONTRACT_CATEGORIES })
  @IsOptional()
  @IsIn(CONTRACT_CATEGORIES)
  category?: ContractCategory;

  @ApiPropertyOptional({ maxLength: 280, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      "Days the owner has to cancel a claim before a release (3 to 30, 7 by default)",
    minimum: 3,
    maximum: 30,
    example: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(30)
  contest_days?: number;
}

class ShareWrapDTO {
  @ApiProperty({ example: "user_2aaaaaaaaaaaaaaa" })
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @ApiProperty({ description: "1 to n, the validator's position", example: 1 })
  @IsInt()
  @Min(1)
  @Max(3)
  index: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  key_version: number;

  @ApiProperty({
    description: "The share wrapped to that validator (HPKE X-Wing), base64",
  })
  @IsBase64()
  @MaxLength(2000)
  wrap: string;
}

/**
 * What the owner's phone sealed (docs/crypto-protocol.md in the app, "Sealing"). The server checks it
 * against the participants and their registered keys; it can never open it.
 */
export class SealContractDTO {
  @ApiProperty({
    description: "The contract version the owner saw",
    example: 1,
  })
  @IsInt()
  @Min(1)
  expected_version: number;

  @ApiProperty({ description: "Must be someone the caller trusts, with keys" })
  @IsString()
  @IsNotEmpty()
  accessor_id: string;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  validator_ids: string[];

  @ApiProperty({ description: "The encrypted secret, base64" })
  @IsBase64()
  @MaxLength(90000)
  envelope: string;

  @ApiProperty({ description: "The contract key wrapped to the owner, base64" })
  @IsBase64()
  @MaxLength(2000)
  owner_wrap: string;

  @ApiProperty({ type: () => [ShareWrapDTO] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ShareWrapDTO)
  shares: ShareWrapDTO[];

  @ApiProperty({
    description: "The manifest the owner signed (behindme/v1/manifest)",
    type: "object",
    additionalProperties: true,
  })
  @IsObject()
  manifest: Record<string, unknown>;

  @ApiProperty({
    description:
      "Ed25519 by the owner over the RFC 8785 JSON of the manifest, base64",
  })
  @IsBase64()
  @MaxLength(100)
  manifest_signature: string;
}

export class RevokeContractDTO {
  @ApiProperty({
    description: "The contract version the owner saw",
    example: 2,
  })
  @IsInt()
  @Min(1)
  expected_version: number;
}

/**
 * A validator's decision on the open claim. Approving is re-wrapping their share to the accessor on
 * their phone (the app's docs/crypto-protocol.md, "Reading and release").
 */
export class DecisionDTO {
  @ApiProperty({
    description: "true to approve the release, false to refuse it",
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({
    description:
      "Approve only: the validator's share, wrapped to the accessor's current key for this claim (HPKE X-Wing), base64",
  })
  @IsOptional()
  @IsBase64()
  @MaxLength(2000)
  release_wrap?: string;

  @ApiPropertyOptional({
    description:
      "Approve only: the accessor key version the share was wrapped to",
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  accessor_key_version?: number;
}
