import { ApiProperty } from "@nestjs/swagger";

export class CreateNotificationDto {
  @ApiProperty({
    description: "Identifier for the associated user",
    example: "user-1234",
  })
  userId: string;

  @ApiProperty({
    description: "Title of the notification",
    example: "Contract update",
  })
  title: string;

  @ApiProperty({
    description: "Message content of the notification",
    example: "Your contract has been updated.",
  })
  message: string;

  @ApiProperty({
    description: "Type of notification",
    enum: ["contract_created", "contract_updated", "reminder", "system"],
    default: "system",
  })
  type: "contract_created" | "contract_updated" | "reminder" | "system" =
    "system";

  @ApiProperty({
    description: "Scheduled time for the notification",
    example: "2023-10-11T12:00:00Z",
    required: false,
  })
  scheduledAt?: Date;

  @ApiProperty({
    description: "Additional metadata for the notification",
    type: Object,
    example: { key: "value" },
    required: false,
  })
  meta?: Record<string, any>;
}
