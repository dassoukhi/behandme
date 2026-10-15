import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsISO8601,
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

export class NewContractDto {
  @IsIn(CONTRACT_CATEGORIES)
  category: ContractCategory;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string | null;

  @IsString()
  @IsNotEmpty()
  accessor_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  validator_ids: string[];
}

export class ContractChangesDto {
  @IsOptional()
  @IsIn(CONTRACT_CATEGORIES)
  category?: ContractCategory;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string | null;
}

class ShareDto {
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @IsInt()
  @Min(1)
  @Max(3)
  index: number;

  @IsInt()
  @Min(1)
  key_version: number;

  @IsBase64()
  @MaxLength(2000)
  wrap: string;
}

class RegisteredKeyDto {
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @IsInt()
  @Min(1)
  key_version: number;

  @IsString()
  fingerprint: string;

  @IsBase64()
  @MaxLength(100)
  signing_public_key: string;

  @IsISO8601()
  usable_from: string;
}

/** The sealed material (from the owner's phone) and the participants' current keys (from the gateway). */
export class SealDto {
  @IsInt()
  @Min(1)
  expected_version: number;

  @IsString()
  @IsNotEmpty()
  accessor_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  validator_ids: string[];

  @IsBase64()
  @MaxLength(90000)
  envelope: string;

  @IsBase64()
  @MaxLength(2000)
  owner_wrap: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  shares: ShareDto[];

  @IsObject()
  manifest: Record<string, unknown>;

  @IsBase64()
  @MaxLength(100)
  manifest_signature: string;

  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => RegisteredKeyDto)
  registered_keys: RegisteredKeyDto[];
}

export class RevokeDto {
  @IsInt()
  @Min(1)
  expected_version: number;
}
