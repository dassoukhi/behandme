import { ApiProperty, PartialType } from "@nestjs/swagger";
import { CreateNotificationDto } from "./create-notifications.dto.js";

export class UpdateNotificationDto extends PartialType(CreateNotificationDto) {
  @ApiProperty({
    description: "Indicates whether the notification has been read",
    example: true,
    required: false,
  })
  isRead?: boolean;
}
