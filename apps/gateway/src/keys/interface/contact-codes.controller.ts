import { Body, Controller, HttpCode, Post, Put } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUserId } from "../../auth/current-user.decorator.js";
import { LOOKUP_THROTTLE } from "../../common/throttle/user-throttler.guard.js";
import { UserProfileDto } from "../../users/interface/dto/user-profile.dto.js";
import { IsNotEmpty, IsString } from "class-validator";
import { ScannedContactService } from "../application/scanned-contact.service.js";
import { toPublicKeys } from "../application/public-keys.js";
import { PublicKeysDto } from "./dto/keys.dto.js";

export class ContactCodeDto {
  @ApiProperty({
    description:
      "Secret of the QR code behyndme-contact/v1/<token>/<fingerprint>. Returned once: the server keeps its hash only.",
    example: "q3V1Zk9n0xg2l6m8b4Jr7Yp5tHc1aW9sE0dQ2uK8vXy",
  })
  token: string;

  @ApiProperty({
    description: "Past this date the code no longer resolves (10 minutes)",
    example: "2026-11-15T10:10:00.000Z",
  })
  expires_at: string;
}

/** The token travels in the body: URLs are logged, by the gateway and by any proxy. */
export class ContactCodeTokenDto {
  @ApiProperty({
    description: "The token read from the QR code",
    example: "q3V1Zk9n0xg2l6m8b4Jr7Yp5tHc1aW9sE0dQ2uK8vXy",
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class ResolvedContactCodeDto {
  @ApiProperty({
    type: UserProfileDto,
    description:
      "The code's owner, with their contact details only if they already trust the caller",
  })
  user: UserProfileDto;

  @ApiProperty({
    type: PublicKeysDto,
    description:
      "The keys the server holds for them: the app compares their fingerprint with the code's",
  })
  keys: PublicKeysDto;

  @ApiProperty({ description: "The caller scanned their own code" })
  own: boolean;
}

// Contact codes (docs/crypto-protocol.md in the app, "Contact code").
@ApiTags("keys")
@ApiBearerAuth()
@Controller()
export class ContactCodesController {
  constructor(private readonly codes: ScannedContactService) {}

  @Put("users/me/contact-code")
  @ApiOperation({
    summary:
      "A contact code for the caller to show in person, valid 10 minutes; replaces the previous one",
  })
  @ApiResponse({ status: 200, type: ContactCodeDto })
  @ApiResponse({ status: 404, description: "The caller has no keys yet" })
  async create(@CurrentUserId() me: string): Promise<ContactCodeDto> {
    const { token, expiresAt } = await this.codes.issue(me);
    return { token, expires_at: expiresAt.toISOString() };
  }

  @Throttle(LOOKUP_THROTTLE)
  @Post("contact-codes/lookup")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Whose contact code the caller scanned: their profile and public keys (the token in the body: URLs are logged)",
  })
  @ApiResponse({ status: 200, type: ResolvedContactCodeDto })
  @ApiResponse({ status: 404, description: "Unknown or expired" })
  @ApiResponse({ status: 429, description: "Too many lookups in a minute" })
  async resolve(
    @CurrentUserId() me: string,
    @Body() body: ContactCodeTokenDto,
  ): Promise<ResolvedContactCodeDto> {
    const resolved = await this.codes.resolve(me, body.token);
    return {
      user: resolved.user,
      keys: toPublicKeys(resolved.keys),
      own: resolved.own,
    };
  }
}
