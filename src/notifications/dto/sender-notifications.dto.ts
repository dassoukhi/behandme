import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmpty, IsString, ValidateNested } from "class-validator";
import { CreateNotificationDto } from "./create-notifications.dto.js";

export class SenderNotificationDto {
  @ApiProperty({
    description: "Expo push token of the target device",
    example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: "Notification to store and push",
    type: () => CreateNotificationDto,
  })
  @ValidateNested()
  @Type(() => CreateNotificationDto)
  notification: CreateNotificationDto;
}
