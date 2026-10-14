import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

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
}
