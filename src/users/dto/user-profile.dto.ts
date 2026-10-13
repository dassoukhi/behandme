import { ApiProperty } from "@nestjs/swagger";

export class UserProfileDto {
  @ApiProperty({
    description: "Clerk user ID",
    example: "user_2abc123def456",
  })
  id: string;

  @ApiProperty({
    description: "User email",
    example: "john.doe@example.com",
  })
  email: string;

  @ApiProperty({
    description: "User first name",
    example: "John",
    required: false,
    nullable: true,
  })
  first_name?: string | null;

  @ApiProperty({
    description: "User last name",
    example: "Doe",
    required: false,
    nullable: true,
  })
  last_name?: string | null;

  @ApiProperty({
    description: "User avatar URL",
    example: "https://example.com/avatar.png",
    required: false,
    nullable: true,
  })
  avatar_url?: string | null;

  @ApiProperty({
    description: "User phone number",
    example: "+33612345678",
    required: false,
    nullable: true,
  })
  phone_number?: string | null;

  @ApiProperty({
    description: "Timestamp when the profile was created",
    example: "2023-01-01T00:00:00.000Z",
  })
  created_at: string;

  @ApiProperty({
    description: "Timestamp when the profile was last updated",
    example: "2023-01-01T00:00:00.000Z",
  })
  updated_at: string;
}
