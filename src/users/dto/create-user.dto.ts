import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateUserDto {
  @ApiProperty({
    description: "Clerk user ID",
    example: "user_2abc123def456",
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: "User email",
    example: "john.doe@example.com",
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: "User first name",
    example: "John",
    required: false,
  })
  @IsString()
  @IsOptional()
  first_name?: string;

  @ApiProperty({
    description: "User last name",
    example: "Doe",
    required: false,
  })
  @IsString()
  @IsOptional()
  last_name?: string;

  @ApiProperty({
    description: "User avatar URL",
    example: "https://example.com/avatar.png",
    required: false,
  })
  @IsString()
  @IsOptional()
  avatar_url?: string;

  @ApiProperty({
    description: "User phone number",
    example: "+33612345678",
    required: false,
  })
  @IsString()
  @IsOptional()
  phone_number?: string;
}
