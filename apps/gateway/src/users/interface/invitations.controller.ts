import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUserId } from "../../auth/current-user.decorator.js";
import { LOOKUP_THROTTLE } from "../../common/throttle/user-throttler.guard.js";
import { InvitationService } from "../application/invitation.service.js";
import type { Invitation } from "../domain/invitation.js";
import {
  AcceptedInvitationDto,
  AcceptInvitationDto,
  CreatedInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
  InvitationTokenDto,
} from "./dto/invitations.dto.js";

const toDto = (invitation: Invitation): InvitationDto => ({
  id: invitation.id,
  created_at: invitation.createdAt.toISOString(),
  expires_at: invitation.expiresAt.toISOString(),
});

@ApiTags("users")
@ApiBearerAuth()
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  @Post("users/me/invitations")
  @ApiOperation({
    summary:
      "Create an invitation link of the caller: used once, within 7 days, by someone else, who then enters the caller's trusted contacts",
  })
  @ApiResponse({ status: 201, type: CreatedInvitationDto })
  @ApiResponse({ status: 409, description: "20 invitations already pending" })
  async create(@CurrentUserId() me: string): Promise<CreatedInvitationDto> {
    const { invitation, token } = await this.invitations.create(me);
    return { ...toDto(invitation), token };
  }

  @Get("users/me/invitations")
  @ApiOperation({
    summary: "The caller's invitations nobody has accepted yet, newest first",
  })
  @ApiResponse({ status: 200, type: [InvitationDto] })
  async pending(@CurrentUserId() me: string): Promise<InvitationDto[]> {
    return (await this.invitations.pending(me)).map(toDto);
  }

  @Delete("users/me/invitations/:id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Cancel one of the caller's pending invitations",
  })
  @ApiResponse({ status: 204, description: "Its link no longer works" })
  @ApiResponse({
    status: 404,
    description: "No such pending invitation of the caller",
  })
  async cancel(
    @CurrentUserId() me: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.invitations.cancel(me, id);
  }

  @Throttle(LOOKUP_THROTTLE)
  @Post("invitations/lookup")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Who sent the invitation link the caller holds (the token in the body: URLs are logged)",
  })
  @ApiResponse({ status: 200, type: InvitationPreviewDto })
  @ApiResponse({
    status: 404,
    description: "Unknown, used, cancelled or expired",
  })
  @ApiResponse({ status: 429, description: "Too many lookups in a minute" })
  async preview(
    @CurrentUserId() me: string,
    @Body() body: InvitationTokenDto,
  ): Promise<InvitationPreviewDto> {
    const preview = await this.invitations.preview(me, body.token);
    return {
      inviter: preview.inviter,
      expires_at: preview.expiresAt.toISOString(),
      own: preview.own,
    };
  }

  @Throttle(LOOKUP_THROTTLE)
  @Post("invitations/accept")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Accept an invitation: the inviter now trusts the caller (and the caller the inviter, with trust_back). The inviter is told.",
  })
  @ApiResponse({ status: 200, type: AcceptedInvitationDto })
  @ApiResponse({ status: 400, description: "The caller's own invitation" })
  @ApiResponse({
    status: 404,
    description: "Unknown, used, cancelled or expired",
  })
  @ApiResponse({ status: 429, description: "Too many lookups in a minute" })
  async accept(
    @CurrentUserId() me: string,
    @Body() body: AcceptInvitationDto,
  ): Promise<AcceptedInvitationDto> {
    const accepted = await this.invitations.accept(
      me,
      body.token,
      body.trust_back,
    );
    return {
      inviter_id: accepted.inviterId,
      trusted_back: accepted.trustedBack,
    };
  }
}
