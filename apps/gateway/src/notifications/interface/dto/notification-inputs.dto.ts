import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  MaxLength,
} from "class-validator";
import {
  NOTIFICATION_LANGUAGES,
  type NotificationLanguage,
} from "@lib/contracts";

export class UpdateNotificationDto {
  @ApiProperty({ description: "Read (true) or unread (false)", example: true })
  @IsBoolean()
  read: boolean;
}

export class PushTokenDto {
  @ApiProperty({
    description: "Expo push token of this device",
    example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  })
  @IsString()
  @MaxLength(256)
  @Matches(/^Expo(nent)?PushToken\[[^\]]+\]$/, {
    message: "token must be an Expo push token",
  })
  token: string;
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  push_enabled?: boolean;

  @ApiPropertyOptional({
    description: "E-mail for non-critical notifications",
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  email_enabled?: boolean;

  @ApiPropertyOptional({
    description: "Language of new notifications",
    enum: NOTIFICATION_LANGUAGES,
    example: "en",
  })
  @IsOptional()
  @IsIn(NOTIFICATION_LANGUAGES)
  language?: NotificationLanguage;

  @ApiPropertyOptional({
    description: "IANA time zone of the phone, for the dates e-mails give",
    example: "Europe/Paris",
  })
  @IsOptional()
  @MaxLength(64)
  @IsTimeZone()
  time_zone?: string;
}
