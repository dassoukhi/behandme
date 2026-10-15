import { ApiProperty } from "@nestjs/swagger";
import { IsBase64, IsInt, Max, MaxLength, Min } from "class-validator";

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
      "Ed25519 signature, base64, by the signing key over the RFC 8785 JSON of {type: 'behindme/v1/key-registration', user_id, key_version, kem_public_key, signing_public_key}",
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
