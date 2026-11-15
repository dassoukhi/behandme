import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class AddTrustedDto {
  @ApiProperty({
    description: "Clerk ID of the user to trust. The owner is the caller.",
    example: "user_2abc123def456",
  })
  @IsString()
  @IsNotEmpty()
  trusted_id: string;

  @ApiProperty({
    description:
      "The token of their contact code, scanned in person. Needed unless they already trust the caller.",
    required: false,
    example: "q3V1Zk9n0xg2l6m8b4Jr7Yp5tHc1aW9sE0dQ2uK8vXy",
  })
  @IsOptional()
  @IsString()
  contact_code?: string;
}

export class TrustedLinkDto {
  @ApiProperty({ example: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5" })
  id: string;

  @ApiProperty({ example: "user_2abc123def456" })
  owner_id: string;

  @ApiProperty({ example: "user_2qrstuvwxyz123456" })
  trusted_id: string;

  @ApiProperty({ example: "2023-01-01T00:00:00.000Z", nullable: true })
  created_at: string | null;
}
