import { ApiProperty } from "@nestjs/swagger";
import {
  IsBase64,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { CREDENTIAL_ID_PATTERN, MADE_AT_PATTERN } from "../../domain/backup.js";
import { PHRASE_LOCATIONS, type PhraseLocation } from "../../domain/care.js";

export class RegisterKeysDto {
  @ApiProperty({ description: "1 for a first registration", example: 1 })
  @IsInt()
  @Min(1)
  @Max(1000)
  key_version: number;

  @ApiProperty({ description: "X-Wing public key, base64 (1216 bytes)" })
  @IsBase64()
  @MaxLength(2000)
  kem_public_key: string;

  @ApiProperty({ description: "Ed25519 public key, base64 (32 bytes)" })
  @IsBase64()
  @MaxLength(100)
  signing_public_key: string;

  @ApiProperty({
    description:
      "Ed25519 signature, base64, by the signing key over the RFC 8785 JSON of {type: 'behyndme/v1/key-registration', user_id, key_version, kem_public_key, signing_public_key}",
  })
  @IsBase64()
  @MaxLength(200)
  signature: string;
}

export class PublicKeysDto {
  @ApiProperty({ example: "user_2abcdefghijklmnop" })
  user_id: string;

  @ApiProperty({ example: 1 })
  key_version: number;

  @ApiProperty({ description: "X-Wing public key, base64" })
  kem_public_key: string;

  @ApiProperty({ description: "Ed25519 public key, base64" })
  signing_public_key: string;

  @ApiProperty({
    description:
      "hex SHA-256 of both keys; its first 30 digits are the security code",
  })
  fingerprint: string;

  @ApiProperty({ description: "The user's signature of these keys, base64" })
  signature: string;

  @ApiProperty({
    description:
      "Others may encrypt to these keys from this time (later than created_at after a reset)",
    example: "2026-10-15T09:00:00.000Z",
  })
  usable_from: string;

  @ApiProperty({ example: "2026-10-15T09:00:00.000Z" })
  created_at: string;
}

export class KeyProofDto {
  @ApiProperty({ description: "The registered key version", example: 1 })
  @IsInt()
  @Min(1)
  @Max(1000)
  key_version: number;

  @ApiProperty({
    description: "Today in UTC; a day either side is accepted",
    example: "2026-10-15",
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day: string;

  @ApiProperty({
    description:
      "Ed25519 signature, base64, by the signing key over the RFC 8785 JSON of {type: 'behyndme/v1/key-proof', user_id, key_version, day}",
  })
  @IsBase64()
  @MaxLength(200)
  signature: string;
}

export class UpdateKeyCareDto {
  @ApiProperty({
    description: "The key version this is about",
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(1000)
  key_version: number;

  @ApiProperty({
    required: false,
    enum: [true],
    description: "The user just proved they kept their recovery phrase",
  })
  @IsOptional()
  @IsIn([true])
  phrase_checked?: true;

  @ApiProperty({
    required: false,
    enum: PHRASE_LOCATIONS,
    description:
      "Where the user says they keep their phrase: a category, never the place",
  })
  @IsOptional()
  @IsIn(PHRASE_LOCATIONS)
  phrase_location?: PhraseLocation;
}

export class PasskeyBackupDto {
  @ApiProperty({
    description:
      "The passkey that holds the backup: its WebAuthn credential id, base64url",
  })
  credential_id: string;

  @ApiProperty({
    description:
      "The passkey syncs to the user's other devices (WebAuthn backup state, as the phone saw it)",
  })
  synced: boolean;

  @ApiProperty({
    description:
      "When the phone made the backup, right after the passkey opened: a passkey that syncs counts for 13 months from then",
    example: "2026-11-11T09:00:00.000Z",
  })
  made_at: string;
}

/** The caller's own keys, and what only they may know about keeping them. */
export class MyKeysDto extends PublicKeysDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description: "The day the phone last proved it holds these keys",
    example: "2026-10-15",
  })
  proven_on: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "The last time the user proved they kept their phrase",
    example: "2026-10-15T09:00:00.000Z",
  })
  phrase_checked_at: string | null;

  @ApiProperty({ description: "Time to check the recovery phrase again" })
  phrase_check_due: boolean;

  @ApiProperty({ enum: PHRASE_LOCATIONS, nullable: true })
  phrase_location: PhraseLocation | null;

  @ApiProperty({
    type: PasskeyBackupDto,
    nullable: true,
    description: "The backup of these keys in a passkey, if any",
  })
  passkey_backup: PasskeyBackupDto | null;
}

export class PutKeyBackupDto {
  @ApiProperty({ description: "The registered key version", example: 1 })
  @IsInt()
  @Min(1)
  @Max(1000)
  key_version: number;

  @ApiProperty({
    description:
      "The passkey whose PRF output keys the box: its WebAuthn credential id, base64url",
  })
  @Matches(CREDENTIAL_ID_PATTERN)
  credential_id: string;

  @ApiProperty({
    description:
      "The passkey syncs to the user's other devices (WebAuthn backup state flag)",
  })
  @IsBoolean()
  synced: boolean;

  @ApiProperty({
    description:
      "When the phone made the box, ISO 8601 in UTC with milliseconds; a day either side of the server's time is accepted, and a backup made later than this one is never replaced",
    example: "2026-11-11T09:00:00.000Z",
  })
  @Matches(MADE_AT_PATTERN)
  made_at: string;

  @ApiProperty({
    description:
      "0x01 ‖ nonce ‖ AES-256-GCM of the seed and its phrase's language, under HKDF-SHA256 of the passkey's PRF output (salt behyndme/v1/passkey-backup, info: user id and credential id), base64 (62 bytes)",
  })
  @IsBase64()
  @MaxLength(200)
  box: string;

  @ApiProperty({
    description:
      "Ed25519 signature, base64, by the signing key over the RFC 8785 JSON of {type: 'behyndme/v1/key-backup', user_id, key_version, credential_id, synced, made_at, box_hash (hex SHA-256 of the box)}",
  })
  @IsBase64()
  @MaxLength(200)
  signature: string;
}

export class OpenKeyBackupDto {
  @ApiProperty({
    description:
      "The passkey the phone just used: the server hands out the box only if it is this one's",
  })
  @Matches(CREDENTIAL_ID_PATTERN)
  credential_id: string;
}

export class KeyBackupBoxDto {
  @ApiProperty({ example: 1 })
  key_version: number;

  @ApiProperty({ description: "The passkey whose PRF output opens the box" })
  credential_id: string;

  @ApiProperty({ description: "The box the phone put in, base64" })
  box: string;
}
