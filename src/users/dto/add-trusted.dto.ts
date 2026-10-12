import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class AddTrustedDto {
  @ApiProperty({
    description: "Unique identifier of the owner (UUID format).",
    example: "987e6543-b21c-45d1-b123-123456789abc",
  })
  @IsString()
  @IsNotEmpty()
  owner_id: string;

  @ApiProperty({
    description: "Unique identifier of the trusted user (UUID format).",
    example: "111e2222-c33b-44c4-b555-666676165543",
  })
  @IsString()
  @IsNotEmpty()
  trusted_id: string;
}
