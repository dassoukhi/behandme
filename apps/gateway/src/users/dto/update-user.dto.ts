import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

// Email, names and avatar are managed in Clerk and synced by POST /users/me.
export class UpdateUserDto {
  @ApiPropertyOptional({ example: "+33612345678", maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone_number?: string;
}
