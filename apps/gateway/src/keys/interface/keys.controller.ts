import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUserId } from "../../auth/current-user.decorator.js";
import { KeysService } from "../application/keys.service.js";
import type { RegisteredKeys } from "../domain/keys.js";
import { PublicKeysDto, RegisterKeysDto } from "./dto/keys.dto.js";

const fromBase64 = (text: string) =>
  new Uint8Array(Buffer.from(text, "base64"));

function toDto(keys: RegisteredKeys): PublicKeysDto {
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  return {
    user_id: keys.userId,
    key_version: keys.keyVersion,
    kem_public_key: b64(keys.kemPublicKey),
    signing_public_key: b64(keys.signingPublicKey),
    fingerprint: keys.fingerprint,
    signature: b64(keys.signature),
    usable_from: keys.usableFrom.toISOString(),
    created_at: keys.createdAt.toISOString(),
  };
}

// Public end-to-end keys. Private keys never reach the server (docs/crypto-protocol.md in the app).
@ApiTags("keys")
@ApiBearerAuth()
@Controller()
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  @Get("users/me/keys")
  @ApiOperation({ summary: "The caller's registered public keys" })
  @ApiResponse({ status: 200, type: PublicKeysDto })
  @ApiResponse({ status: 404, description: "No keys registered yet" })
  async mine(@CurrentUserId() me: string): Promise<PublicKeysDto> {
    return toDto(await this.keys.mine(me));
  }

  @Post("users/me/keys")
  @ApiOperation({
    summary: "Register the caller's first public keys (signed by the caller)",
  })
  @ApiResponse({ status: 201, type: PublicKeysDto })
  @ApiResponse({
    status: 400,
    description: "Malformed keys or a signature that does not verify",
  })
  @ApiResponse({ status: 409, description: "Keys are already registered" })
  async register(
    @CurrentUserId() me: string,
    @Body() body: RegisterKeysDto,
  ): Promise<PublicKeysDto> {
    return toDto(
      await this.keys.register(me, {
        keyVersion: body.key_version,
        kemPublicKey: fromBase64(body.kem_public_key),
        signingPublicKey: fromBase64(body.signing_public_key),
        signature: fromBase64(body.signature),
      }),
    );
  }

  @Get("keys")
  @ApiOperation({
    summary:
      "Public keys of some users: the caller, people they trust and people who trust them. Users without keys are left out.",
  })
  @ApiQuery({
    name: "user_ids",
    description: "Comma-separated Clerk ids (50 at most)",
    required: true,
  })
  @ApiResponse({ status: 200, type: [PublicKeysDto] })
  async visible(
    @CurrentUserId() me: string,
    @Query("user_ids") userIds: string,
  ): Promise<PublicKeysDto[]> {
    const ids = (userIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return (await this.keys.visible(me, ids)).map(toDto);
  }
}
