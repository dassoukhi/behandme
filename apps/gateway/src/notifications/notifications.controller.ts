import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service.js";
import { NotificationDto } from "./dto/notifications.dto.js";
import { UpdateNotificationDto } from "./dto/update-notifications.dto.js";
import { RegisterTokenDto } from "./dto/register-token.dto.js";
import { Public } from "../decorators/public.decorator.js";
import { CurrentUserId } from "../auth/current-user.decorator.js";

// Notifications are created and pushed by the server (NotificationsService /
// ExpoService), never by clients: there is no create or send route.
@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationservice: NotificationsService) {}

  @Public()
  @Post("register-token")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Register a device push token before sign-in (not linked to any user)",
  })
  @ApiResponse({ status: 200, type: RegisterTokenDto })
  registerOrphanToken(
    @Body() registerTokenDto: RegisterTokenDto,
  ): Promise<RegisterTokenDto> {
    return this.notificationservice.registerOrphanToken(registerTokenDto);
  }

  @Post("push-token")
  @HttpCode(200)
  @ApiOperation({ summary: "Link a device push token to the caller" })
  @ApiResponse({ status: 200, type: RegisterTokenDto })
  registerPushToken(
    @CurrentUserId() me: string,
    @Body() registerTokenDto: RegisterTokenDto,
  ): Promise<RegisterTokenDto> {
    return this.notificationservice.registerPushToken(me, registerTokenDto);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's notifications" })
  @ApiResponse({ status: 200, type: [NotificationDto] })
  findAll(@CurrentUserId() me: string): Promise<NotificationDto[]> {
    return this.notificationservice.findAll(me);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one of the caller's notifications" })
  @ApiResponse({ status: 200, type: NotificationDto })
  @ApiResponse({ status: 404, description: "Notification not found" })
  findOne(
    @CurrentUserId() me: string,
    @Param("id") id: string,
  ): Promise<NotificationDto> {
    return this.notificationservice.findOne(me, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Mark one of the caller's notifications as read" })
  @ApiResponse({ status: 200, type: NotificationDto })
  @ApiResponse({ status: 404, description: "Notification not found" })
  update(
    @CurrentUserId() me: string,
    @Param("id") id: string,
    @Body() updateNotificationDto: UpdateNotificationDto,
  ): Promise<NotificationDto> {
    return this.notificationservice.update(me, id, updateNotificationDto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete one of the caller's notifications" })
  @ApiResponse({ status: 200, description: "Notification deleted" })
  @ApiResponse({ status: 404, description: "Notification not found" })
  remove(
    @CurrentUserId() me: string,
    @Param("id") id: string,
  ): Promise<{ message: string }> {
    return this.notificationservice.remove(me, id);
  }
}
