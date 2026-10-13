import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class RegisterTokenDto {
  @ApiProperty({
    description: "Expo push token of the device",
    example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
