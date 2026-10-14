import { ApiProperty } from "@nestjs/swagger";
import type {
  InboxNotification,
  MarkedRead,
  NotificationPreferences,
  UnreadCount,
} from "@lib/contracts";

export class NotificationDto implements InboxNotification {
  @ApiProperty({ example: "123e4567-e89b-12d3-a456-426614174000" })
  id: string;

  @ApiProperty({
    description:
      "Kind of notification, e.g. trust_added. Unknown kinds may appear: show them as generic.",
    example: "trust_added",
  })
  type: string;

  @ApiProperty({ example: "Nouveau proche" })
  title: string;

  @ApiProperty({ example: "Sam Durand vous a ajouté à ses proches." })
  body: string;

  @ApiProperty({
    description: "Includes `url`, the app screen to open when tapped",
    type: "object",
    additionalProperties: true,
    example: { url: "/people/user_2abc123def456" },
  })
  data: Record<string, unknown>;

  @ApiProperty({
    description: "When it was read; null while unread",
    example: null,
    nullable: true,
    type: String,
  })
  read_at: string | null;

  @ApiProperty({ example: "2026-10-14T12:34:56.000Z" })
  created_at: string;
}

export class UnreadCountDto implements UnreadCount {
  @ApiProperty({ example: 3 })
  count: number;
}

export class MarkedReadDto implements MarkedRead {
  @ApiProperty({ description: "Notifications marked as read", example: 3 })
  updated: number;
}

export class NotificationPreferencesDto implements NotificationPreferences {
  @ApiProperty({
    description:
      "Push for non-critical notifications. Critical ones (a claim on your contract) are always pushed.",
    example: true,
  })
  push_enabled: boolean;
}
