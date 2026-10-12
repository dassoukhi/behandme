import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RegisterTokenDto {
  @ApiProperty({
    description: "The unique token string used for device registration.",
    example: "abc123def456",
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description:
      "The unique identifier of the user who owns the token. Optional field.",
    example: "user-12345",
    required: false,
  })
  @IsString()
  @IsOptional()
  user_id?: string; // Add a question mark to make it optional
}
