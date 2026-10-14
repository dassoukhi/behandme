import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
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
