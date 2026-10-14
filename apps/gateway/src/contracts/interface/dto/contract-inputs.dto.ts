import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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
