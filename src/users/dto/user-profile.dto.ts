import { ApiProperty } from "@nestjs/swagger";

export class UserProfileDto {
  @ApiProperty({
    description: "User ID (UUID)",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  id: string;

  @ApiProperty({
    description: "User first name",
    example: "John Doe",
  })
  first_name: string;

  @ApiProperty({
    description: "User last name",
    example: "John Doe",
  })
  last_name: string;

  @ApiProperty({
    description: "User avatar URL",
    example: "https://example.com/avatar.png",
  })
  avatar_url?: string;

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
