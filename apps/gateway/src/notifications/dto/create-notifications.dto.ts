import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

export const NOTIFICATION_TYPES = [
  "contract_created",
  "contract_updated",
  "reminder",
  "system",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Field names match the `notifications` table columns (userId is camelCase in the DB).
export class CreateNotificationDto {
  @ApiProperty({
    description: "Identifier of the recipient user",
    example: "user_2abc123def456",
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: "Title of the notification",
    example: "Contract update",
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: "Message content of the notification",
    example: "Your contract has been updated.",
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    description: "Type of notification",
    enum: NOTIFICATION_TYPES,
    default: "system",
    required: false,
  })
  @IsIn(NOTIFICATION_TYPES)
  @IsOptional()
  type?: NotificationType;

  @ApiProperty({
    description: "Scheduled time for the notification (ISO 8601)",
    example: "2023-10-11T12:00:00Z",
    required: false,
  })
  @IsDateString()
  @IsOptional()
  scheduled_at?: string;

  @ApiPropertyOptional({
    description: "Additional metadata",
    type: "object",
    additionalProperties: true,
    example: { key: "value" },
  })
  @IsObject()
  @IsOptional()
  meta?: Record<string, any>;

  @ApiPropertyOptional({
    description: "Payload delivered with the notification (defaults to {})",
    type: "object",
    additionalProperties: true,
    example: { contractId: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5" },
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}
