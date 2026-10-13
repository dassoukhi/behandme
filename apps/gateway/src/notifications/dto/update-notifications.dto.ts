import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

// The app may only change the read state of its own notifications.
export class UpdateNotificationDto {
  @ApiProperty({
    description: "Indicates whether the notification has been read",
    example: true,
  })
  @IsBoolean()
  is_read: boolean;
}
