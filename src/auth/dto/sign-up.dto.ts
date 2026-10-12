import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class SignUpDto {
  @ApiProperty({
    description: "The email of the user",
    example: "user@example.com",
  })
  @IsEmail({}, { message: "Please provide a valid email" })
  email: string;

  @ApiProperty({
    description: "The password of the user",
    example: "Password123!",
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters long" })
  password: string;
}
