import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

// The profile id and email come from the verified Clerk identity, never from
// the body. Names default to the Clerk values and can be overridden here.
export class EnsureProfileDto {
  @ApiPropertyOptional({ example: "John", maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name?: string;

  @ApiPropertyOptional({ example: "Doe", maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;
}
