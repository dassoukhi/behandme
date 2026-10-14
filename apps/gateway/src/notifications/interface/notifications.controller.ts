import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUserId } from "../../auth/current-user.decorator.js";
import { NOTIFIER_CLIENT, type NotifierClient } from "../application/ports.js";
import {
  MarkedReadDto,
  NotificationDto,
  NotificationPreferencesDto,
  UnreadCountDto,
} from "./dto/notification.dto.js";
import {
  PushTokenDto,
  UpdateNotificationDto,
  UpdateNotificationPreferencesDto,
} from "./dto/notification-inputs.dto.js";

// Served by the notifier service; the gateway only authenticates the caller and relays the request
// for them. Notifications are created by the services from events: there is no create route.
@ApiTags("notifications")
@ApiBearerAuth()
@ApiResponse({ status: 503, description: "The notifier is unavailable" })
@Controller("notifications")
export class NotificationsController {
  constructor(
    @Inject(NOTIFIER_CLIENT) private readonly notifier: NotifierClient,
  ) {}

  // Static routes must be declared before ":id".

  @Get()
  @ApiOperation({ summary: "The caller's latest notifications, newest first" })
  @ApiResponse({ status: 200, type: [NotificationDto] })
  findAll(@CurrentUserId() me: string): Promise<NotificationDto[]> {
    return this.notifier.inbox(me);
  }

  @Get("unread-count")
  @ApiOperation({
    summary: "How many of the caller's notifications are unread",
  })
  @ApiResponse({ status: 200, type: UnreadCountDto })
  unreadCount(@CurrentUserId() me: string): Promise<UnreadCountDto> {
    return this.notifier.unreadCount(me);
  }

  @Post("read-all")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark all the caller's notifications as read" })
  @ApiResponse({ status: 200, type: MarkedReadDto })
  markAllRead(@CurrentUserId() me: string): Promise<MarkedReadDto> {
    return this.notifier.markAllRead(me);
  }

  @Post("push-token")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Send this device's pushes to the caller (a device belongs to whoever signed in on it last)",
  })
  @ApiResponse({ status: 200, type: PushTokenDto })
  async registerPushToken(
    @CurrentUserId() me: string,
    @Body() { token }: PushTokenDto,
  ): Promise<PushTokenDto> {
    await this.notifier.registerPushToken(me, token);
    return { token };
  }

  @Post("push-token/unregister")
  @HttpCode(200)
  @ApiOperation({
    summary: "Stop pushes to this device (call before signing out)",
  })
  @ApiResponse({ status: 200, type: PushTokenDto })
  async unregisterPushToken(
    @CurrentUserId() me: string,
    @Body() { token }: PushTokenDto,
  ): Promise<PushTokenDto> {
    await this.notifier.unregisterPushToken(me, token);
    return { token };
  }

  @Get("preferences")
  @ApiOperation({ summary: "The caller's notification settings" })
  @ApiResponse({ status: 200, type: NotificationPreferencesDto })
  preferences(
    @CurrentUserId() me: string,
  ): Promise<NotificationPreferencesDto> {
    return this.notifier.preferences(me);
  }

  @Patch("preferences")
  @ApiOperation({ summary: "Change the caller's notification settings" })
  @ApiResponse({ status: 200, type: NotificationPreferencesDto })
  updatePreferences(
    @CurrentUserId() me: string,
    @Body() changes: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    return this.notifier.updatePreferences(me, changes);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Mark one of the caller's notifications as read or unread",
  })
  @ApiResponse({ status: 200, type: NotificationDto })
  @ApiResponse({ status: 404, description: "Notification not found" })
  update(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() { read }: UpdateNotificationDto,
  ): Promise<NotificationDto> {
    return this.notifier.markRead(me, id, read);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete one of the caller's notifications" })
  @ApiResponse({ status: 200, description: "Notification deleted" })
  @ApiResponse({ status: 404, description: "Notification not found" })
  async remove(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    await this.notifier.remove(me, id);
    return { message: "Notification deleted" };
  }
}
