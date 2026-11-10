import { reverificationError } from "@clerk/backend/internal";
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  CurrentUserId,
  CurrentVerificationAge,
} from "../../auth/current-user.decorator.js";
import {
  KeyCareService,
  NO_KEY_CARE,
} from "../application/key-care.service.js";
import { KeysService } from "../application/keys.service.js";
import { toPublicKeys } from "../application/public-keys.js";
import {
  type KeySubmission,
  type RegisteredKeys,
  RESET_REVERIFICATION,
  ReverificationRequired,
} from "../domain/keys.js";
import {
  KeyProofDto,
  MyKeysDto,
  PublicKeysDto,
  RegisterKeysDto,
  UpdateKeyCareDto,
} from "./dto/keys.dto.js";

const fromBase64 = (text: string) =>
  new Uint8Array(Buffer.from(text, "base64"));

const toSubmission = (body: RegisterKeysDto): KeySubmission => ({
  keyVersion: body.key_version,
  kemPublicKey: fromBase64(body.kem_public_key),
  signingPublicKey: fromBase64(body.signing_public_key),
  signature: fromBase64(body.signature),
});

const toDto = (keys: RegisteredKeys): PublicKeysDto => toPublicKeys(keys);

/** Made from what was just written: a failed read must not make accepted keys look refused to the app. */
const newKeysDto = (keys: RegisteredKeys): MyKeysDto => ({
  ...toDto(keys),
  ...NO_KEY_CARE,
});

// Public end-to-end keys. Private keys never reach the server (docs/crypto-protocol.md in the app).
@ApiTags("keys")
@ApiBearerAuth()
@Controller()
export class KeysController {
  constructor(
    private readonly keys: KeysService,
    private readonly care: KeyCareService,
  ) {}

  private async myKeys(me: string): Promise<MyKeysDto> {
    const [keys, care] = await Promise.all([
      this.keys.mine(me),
      this.care.mine(me),
    ]);
    return { ...toDto(keys), ...care };
  }

  @Get("users/me/keys")
  @ApiOperation({ summary: "The caller's registered public keys" })
  @ApiResponse({ status: 200, type: MyKeysDto })
  @ApiResponse({ status: 404, description: "No keys registered yet" })
  mine(@CurrentUserId() me: string): Promise<MyKeysDto> {
    return this.myKeys(me);
  }

  @Post("users/me/keys")
  @ApiOperation({
    summary: "Register the caller's first public keys (signed by the caller)",
  })
  @ApiResponse({ status: 201, type: MyKeysDto })
  @ApiResponse({
    status: 400,
    description: "Malformed keys or a signature that does not verify",
  })
  @ApiResponse({ status: 409, description: "Keys are already registered" })
  async register(
    @CurrentUserId() me: string,
    @Body() body: RegisterKeysDto,
  ): Promise<MyKeysDto> {
    return newKeysDto(await this.keys.register(me, toSubmission(body)));
  }

  @Post("users/me/keys/proof")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "The phone proves it still holds the registered keys (a signature of the day)",
  })
  @ApiResponse({ status: 200, type: MyKeysDto })
  @ApiResponse({
    status: 400,
    description: "A day that is not today, or a signature that does not verify",
  })
  @ApiResponse({ status: 404, description: "No keys registered yet" })
  @ApiResponse({ status: 409, description: "The keys changed meanwhile" })
  async prove(
    @CurrentUserId() me: string,
    @Body() body: KeyProofDto,
  ): Promise<MyKeysDto> {
    await this.care.prove(me, {
      keyVersion: body.key_version,
      day: body.day,
      signature: fromBase64(body.signature),
    });
    return this.myKeys(me);
  }

  @Patch("users/me/keys/care")
  @ApiOperation({
    summary:
      "The user just proved they kept their recovery phrase, or says where they keep it",
  })
  @ApiResponse({ status: 200, type: MyKeysDto })
  @ApiResponse({ status: 400, description: "Nothing to change" })
  @ApiResponse({ status: 404, description: "No keys registered yet" })
  @ApiResponse({ status: 409, description: "The keys changed meanwhile" })
  async updateCare(
    @CurrentUserId() me: string,
    @Body() body: UpdateKeyCareDto,
  ): Promise<MyKeysDto> {
    await this.care.updatePhrase(me, {
      keyVersion: body.key_version,
      checked: body.phrase_checked,
      location: body.phrase_location,
    });
    return this.myKeys(me);
  }

  @Post("users/me/keys/reset")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Replace the caller's lost or compromised keys (signed by the new keys, next key_version). Needs a Clerk reverification less than 10 minutes old; others may use the new keys after a quarantine (72 h).",
  })
  @ApiResponse({ status: 200, type: MyKeysDto })
  @ApiResponse({
    status: 400,
    description:
      "Malformed keys, a signature that does not verify, or the current keys again",
  })
  @ApiResponse({
    status: 403,
    description:
      "Reverification needed: the body is Clerk's reverification hint (clerk_error), handled by useReverification",
  })
  @ApiResponse({ status: 404, description: "No keys registered yet" })
  @ApiResponse({
    status: 409,
    description:
      "key_version is not the next one, or the keys changed meanwhile",
  })
  async reset(
    @CurrentUserId() me: string,
    @CurrentVerificationAge() fva: [number, number] | null,
    @Body() body: RegisterKeysDto,
  ): Promise<MyKeysDto> {
    try {
      return newKeysDto(await this.keys.reset(me, toSubmission(body), fva));
    } catch (error) {
      if (error instanceof ReverificationRequired) {
        throw new ForbiddenException(reverificationError(RESET_REVERIFICATION));
      }
      throw error;
    }
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
