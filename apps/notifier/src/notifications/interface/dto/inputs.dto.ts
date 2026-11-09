import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import {
  NOTIFICATION_LANGUAGES,
  type NotificationLanguage,
} from "@lib/contracts";

export class SetReadDto {
  @IsBoolean()
  read: boolean;
}

export class PushTokenDto {
  @IsString()
  @MaxLength(256)
  @Matches(/^Expo(nent)?PushToken\[[^\]]+\]$/, {
    message: "token must be an Expo push token",
  })
  token: string;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  push_enabled?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_LANGUAGES)
  language?: NotificationLanguage;
}
