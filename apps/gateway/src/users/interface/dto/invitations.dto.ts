import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsNotEmpty, IsString } from "class-validator";
import { UserProfileDto } from "./user-profile.dto.js";

export class InvitationDto {
  @ApiProperty({ example: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5" })
  id: string;

  @ApiProperty({ example: "2026-11-15T10:00:00.000Z" })
  created_at: string;

  @ApiProperty({
    description: "Past this date the link no longer works (7 days)",
    example: "2026-11-22T10:00:00.000Z",
  })
  expires_at: string;
}

export class CreatedInvitationDto extends InvitationDto {
  @ApiProperty({
    description:
      "Secret of the link https://behyndme.com/i#<token> (in the fragment, which browsers never send), sent by the inviter's own phone. Returned once: the server keeps its hash only.",
    example: "q3V1Zk9n0xg2l6m8b4Jr7Yp5tHc1aW9sE0dQ2uK8vXy",
  })
  token: string;
}

export class InvitationPreviewDto {
  @ApiProperty({
    type: UserProfileDto,
    description:
      "The inviter, with their contact details only if they already trust the caller",
  })
  inviter: UserProfileDto;

  @ApiProperty({ example: "2026-11-22T10:00:00.000Z" })
  expires_at: string;

  @ApiProperty({
    description: "The caller is the inviter: they opened their own link",
  })
  own: boolean;
}

/** The token travels in the body: URLs are logged, by the gateway and by any proxy. */
export class InvitationTokenDto {
  @ApiProperty({
    description: "The token of the invitation link (its fragment)",
    example: "q3V1Zk9n0xg2l6m8b4Jr7Yp5tHc1aW9sE0dQ2uK8vXy",
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class AcceptInvitationDto extends InvitationTokenDto {
  @ApiProperty({
    description:
      "Also trust the inviter, who then sees the caller's contact details",
  })
  @IsBoolean()
  trust_back: boolean;
}

export class AcceptedInvitationDto {
  @ApiProperty({
    description: "The inviter, who now trusts the caller",
    example: "user_2abc123def456",
  })
  inviter_id: string;

  @ApiProperty({
    description:
      "The caller trusts the inviter too, newly (trust_back) or from before",
  })
  trusted_back: boolean;
}
