import { ApiProperty } from "@nestjs/swagger";
import { IsBase64, IsInt, Max, MaxLength, Min } from "class-validator";

export class OpenKeyTransferDto {
  @ApiProperty({
    description:
      "X-Wing public key, base64 (1216 bytes), made by the new phone for this transfer only",
  })
  @IsBase64()
  @MaxLength(2000)
  recipient_key: string;
}

export class KeyTransferDto {
  @ApiProperty({ example: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5" })
  id: string;

  @ApiProperty({
    description:
      "The new phone's public key, base64: the old phone checks it against the code it scanned",
  })
  recipient_key: string;

  @ApiProperty({ description: "The key version to send", example: 1 })
  key_version: number;

  @ApiProperty({ description: "The old phone sent the keys" })
  ready: boolean;

  @ApiProperty({ example: "2026-11-10T09:05:00.000Z" })
  expires_at: string;
}

export class DepositKeyTransferDto {
  @ApiProperty({ description: "The registered key version", example: 1 })
  @IsInt()
  @Min(1)
  @Max(1000)
  key_version: number;

  @ApiProperty({
    description:
      "The seed and its phrase's language, wrapped to recipient_key with HPKE in PSK mode (X-Wing, HKDF-SHA256, AES-256-GCM; the PSK is the secret in the new phone's QR code, which the server never sees; info behindme/v1/wrap/transfer|transfer=<id>|user=<id>|key=<key_version>), base64 (1170 bytes)",
  })
  @IsBase64()
  @MaxLength(2000)
  wrap: string;
}

export class TakenKeyTransferDto {
  @ApiProperty({ example: 1 })
  key_version: number;

  @ApiProperty({ description: "The wrap the old phone sent, base64" })
  wrap: string;
}
