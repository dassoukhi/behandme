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

export const CONTRACT_CATEGORIES = ["networks", "devices", "storage"] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

// The owner is the authenticated caller. Status, secret material and any
// lifecycle field are server-controlled and never accepted from the client.
export class CreateContractDTO {
  @ApiProperty({
    description: "Contract category",
    enum: CONTRACT_CATEGORIES,
    example: "networks",
  })
  @IsIn(CONTRACT_CATEGORIES)
  name: ContractCategory;

  @ApiPropertyOptional({
    description:
      "Short description visible to every participant: never put anything secret here",
    maxLength: 280,
    example: "Accès à mes réseaux sociaux",
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiProperty({
    description: "Clerk ID of the accessor (must be someone the caller trusts)",
    example: "user_2qrstuvwxyz123456",
  })
  @IsString()
  @IsNotEmpty()
  accessor_id: string;

  @ApiProperty({
    description:
      "Clerk IDs of 1 to 3 distinct validators (people the caller trusts)",
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
  validators: string[];
}
