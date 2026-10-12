import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsObject, IsString } from "class-validator";
import { CreateNotificationDto } from "./create-notifications.dto";

export class SenderNotificationDto {
  @ApiProperty({
    description: "token",
    example: true,
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: "Notification",
    example: {
      title: "Welcome Notification",
      message: "Hello! Welcome to our service!",
      data: '{"action":"welcome"}',
    },
  })
  @IsNotEmpty()
  @IsObject()
  notification: CreateNotificationDto;
}
