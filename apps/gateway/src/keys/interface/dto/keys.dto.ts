import { ApiProperty } from "@nestjs/swagger";
import {
  IsBase64,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
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
}
