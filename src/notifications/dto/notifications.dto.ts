import { ApiProperty } from "@nestjs/swagger";
import {
  IsUUID,
  IsString,
  IsBoolean,
  IsDate,
  IsOptional,
} from "class-validator";

export class NotificationDto {
  @ApiProperty({
    description: "Unique identifier for the notification",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  @IsUUID()
  id: string;

  @ApiProperty({
    description: "Identifier for the associated user",
    example: "user-1234",
  })
  @IsString()
  userId: string;

  @ApiProperty({
    description: "Title of the notification",
    example: "Contract updated",
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: "Message content of the notification",
    example: "Your contract has been updated.",
  })
  @IsString()
  message: string;

  @ApiProperty({
    description: "Type of notification",
    enum: ["contract_created", "contract_updated", "reminder", "system"],
    default: "system",
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: "Indicates whether the notification has been read",
    default: false,
  })
  @IsBoolean()
  isRead: boolean;

  @ApiProperty({
    description: "Timestamp when notification was created",
    example: "2023-10-10T12:34:56Z",
  })
  @IsDate()
  createdAt: Date;

  @ApiProperty({
    description: "Scheduled time for the notification",
    example: "2023-10-11T12:00:00Z",
    required: false,
  })
  @IsOptional()
  @IsDate()
  scheduledAt?: Date;

  @ApiProperty({
    description: "Additional metadata for the notification",
    type: "object",
    example: { key: "value" },
    required: false,
  })
  @IsOptional()
  meta?: object;
}
