import { ApiProperty } from "@nestjs/swagger";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from "./create-notifications.dto.js";

// Mirrors a row of the `notifications` table.
export class NotificationDto {
  @ApiProperty({
    description: "Unique identifier for the notification",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  id: string;

  @ApiProperty({
    description: "Identifier of the recipient user",
    example: "user_2abc123def456",
    nullable: true,
  })
  userId: string | null;

  @ApiProperty({
    description: "Title of the notification",
    example: "Contract updated",
  })
  title: string;

  @ApiProperty({
    description: "Message content of the notification",
    example: "Your contract has been updated.",
  })
  message: string;

  @ApiProperty({
    description: "Type of notification",
    enum: NOTIFICATION_TYPES,
    nullable: true,
  })
  type: NotificationType | null;

  @ApiProperty({
    description: "Indicates whether the notification has been read",
    default: false,
    nullable: true,
  })
  is_read: boolean | null;

  @ApiProperty({
    description: "Timestamp when the notification was created",
    example: "2023-10-10T12:34:56Z",
    nullable: true,
  })
  created_at: string | null;

  @ApiProperty({
    description: "Scheduled time for the notification",
    example: "2023-10-11T12:00:00Z",
    nullable: true,
  })
  scheduled_at: string | null;

  @ApiProperty({
    description: "Additional metadata",
    type: "object",
    additionalProperties: true,
    example: { key: "value" },
    nullable: true,
  })
  meta: Record<string, any> | null;

  @ApiProperty({
    description: "Payload delivered with the notification",
    type: "object",
    additionalProperties: true,
    example: { contractId: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5" },
  })
  data: Record<string, any>;
}
