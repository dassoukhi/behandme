import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBase64,
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
}

// Only descriptive fields; participants change by re-sealing (phase 4).
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
