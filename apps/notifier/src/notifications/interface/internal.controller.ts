import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import type {
  InboxNotification,
  MarkedRead,
  NotificationPreferences,
  UnreadCount,
} from "@lib/contracts";
import { ForUser } from "@lib/platform";
import { InboxService } from "../application/inbox.service.js";
import {
  PushTokenDto,
  SetReadDto,
  UpdatePreferencesDto,
} from "./dto/inputs.dto.js";

// Internal API, called by the gateway only (internal token, whose subject is the user). Every
// query is scoped to that user: another user's notification answers 404.

@Controller("inbox")
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@ForUser() userId: string): Promise<InboxNotification[]> {
    return this.inbox.list(userId);
  }

  @Get("unread-count")
  unreadCount(@ForUser() userId: string): Promise<UnreadCount> {
    return this.inbox.unreadCount(userId);
  }

  @Post("read-all")
  @HttpCode(200)
  markAllRead(@ForUser() userId: string): Promise<MarkedRead> {
    return this.inbox.markAllRead(userId);
  }

  @Patch(":id")
  setRead(
    @ForUser() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() { read }: SetReadDto,
  ): Promise<InboxNotification> {
    return this.inbox.setRead(userId, id, read);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @ForUser() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.inbox.remove(userId, id);
  }
}

@Controller("push-tokens")
export class PushTokensController {
  constructor(private readonly inbox: InboxService) {}

  @Post()
  @HttpCode(204)
  register(@ForUser() userId: string, @Body() { token }: PushTokenDto) {
    return this.inbox.registerDevice(userId, token);
  }

  @Post("unregister")
  @HttpCode(204)
  unregister(@ForUser() userId: string, @Body() { token }: PushTokenDto) {
    return this.inbox.unregisterDevice(userId, token);
  }
}

@Controller("preferences")
export class PreferencesController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  get(@ForUser() userId: string): Promise<NotificationPreferences> {
    return this.inbox.preferences(userId);
  }

  @Patch()
  update(
    @ForUser() userId: string,
    @Body() changes: UpdatePreferencesDto,
  ): Promise<NotificationPreferences> {
    return this.inbox.updatePreferences(userId, changes);
  }
}
