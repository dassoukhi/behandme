import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { ProfileService } from "../application/profile.service.js";
import { TrustService } from "../application/trust.service.js";
import { EnsureProfileDto } from "./dto/create-user.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UserProfileDto } from "./dto/user-profile.dto.js";
import { AddTrustedDto, TrustedLinkDto } from "./dto/add-trusted.dto.js";
import { CurrentUserId } from "../../auth/current-user.decorator.js";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly trust: TrustService,
  ) {}

  // Static routes (me, search) must be declared before ":id".

  @Post("me")
  @ApiOperation({
    summary:
      "Create or sync the caller's profile from their verified identity (idempotent; call after sign-in)",
  })
  @ApiResponse({
    status: 201,
    description: "Profile created",
    type: UserProfileDto,
  })
  @ApiResponse({
    status: 200,
    description: "Existing profile synced",
    type: UserProfileDto,
  })
  @ApiResponse({
    status: 422,
    description: "The account has no verified email",
  })
  async ensureMe(
    @CurrentUserId() me: string,
    @Body() ensureProfileDto: EnsureProfileDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserProfileDto> {
    const { profile, created } = await this.profiles.ensureMe(
      me,
      ensureProfileDto,
    );
    res.status(created ? 201 : 200);
    return profile;
  }

  @Get("me")
  @ApiOperation({ summary: "Get the caller's profile" })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({ status: 404, description: "Profile not found" })
  findMe(@CurrentUserId() me: string): Promise<UserProfileDto> {
    return this.profiles.findMe(me);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update the caller's profile" })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({ status: 404, description: "Profile not found" })
  updateMe(
    @CurrentUserId() me: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserProfileDto> {
    return this.profiles.updateMe(me, updateUserDto);
  }

  @Delete("me")
  @ApiOperation({ summary: "Delete the caller's profile" })
  @ApiResponse({ status: 200, description: "Profile deleted successfully" })
  @ApiResponse({ status: 404, description: "Profile not found" })
  async removeMe(@CurrentUserId() me: string): Promise<{ message: string }> {
    await this.profiles.removeMe(me);
    return { message: "Profile deleted successfully" };
  }

  @Get("me/trusteds")
  @ApiOperation({ summary: "List the users the caller trusts" })
  @ApiResponse({ status: 200, type: [UserProfileDto] })
  getMyTrusteds(@CurrentUserId() me: string): Promise<UserProfileDto[]> {
    return this.trust.listTrusted(me);
  }

  @Post("me/trusteds")
  @ApiOperation({ summary: "Trust a user" })
  @ApiResponse({ status: 201, type: TrustedLinkDto })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 409, description: "User is already trusted" })
  addTrusted(
    @CurrentUserId() me: string,
    @Body() addTrustedDto: AddTrustedDto,
  ): Promise<TrustedLinkDto> {
    return this.trust.add(me, addTrustedDto.trusted_id);
  }

  @Delete("me/trusteds/:trustedId")
  @ApiOperation({ summary: "Stop trusting a user" })
  @ApiResponse({ status: 200, description: "User no longer trusted" })
  @ApiResponse({ status: 404, description: "The caller does not trust them" })
  async removeTrusted(
    @CurrentUserId() me: string,
    @Param("trustedId") trustedId: string,
  ): Promise<{ message: string }> {
    await this.trust.remove(me, trustedId);
    return { message: "User no longer trusted" };
  }

  @Get("me/trusted-by")
  @ApiOperation({
    summary: "List the users who trust the caller (with their contact details)",
  })
  @ApiResponse({ status: 200, type: [UserProfileDto] })
  getTrustedBy(@CurrentUserId() me: string): Promise<UserProfileDto[]> {
    return this.trust.listTrustedBy(me);
  }

  @Get("search")
  @ApiOperation({
    summary:
      "Search users by first/last name (partial) or email (exact), excluding the caller and users they already trust",
  })
  @ApiQuery({ name: "q", required: true, description: "Search query" })
  @ApiResponse({ status: 200, type: [UserProfileDto] })
  searchUsers(
    @CurrentUserId() me: string,
    @Query("q") query: string,
  ): Promise<UserProfileDto[]> {
    return this.profiles.search(me, query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get a user profile (contact details only if they trust you)",
  })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({ status: 404, description: "Profile not found" })
  findOne(
    @CurrentUserId() me: string,
    @Param("id") id: string,
  ): Promise<UserProfileDto> {
    return this.profiles.findOne(me, id);
  }
}
