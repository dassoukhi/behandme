import { ApiProperty } from "@nestjs/swagger";

export class RegisterOrphanTokenDto {
  @ApiProperty({
    description: "token",
    example: true,
    required: true,
  })
  token: string;
}
