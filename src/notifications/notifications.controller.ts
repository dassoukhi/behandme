import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service.js";
import { CreateNotificationDto } from "./dto/create-notifications.dto.js";
import { NotificationDto } from "./dto/notifications.dto.js";
import { UpdateNotificationDto } from "./dto/update-notifications.dto.js";
import { RegisterTokenDto } from "./dto/register-token.dto.js";
import { Public } from "../decorators/public.decorator.js";
import { SenderNotificationDto } from "./dto/sender-notifications.dto.js";
import { ExpoService } from "../expo/expo.service.js";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notificationservice: NotificationsService,
    private readonly expoService: ExpoService
  ) {}

  @Public()
  @Post("register-token")
  @ApiOperation({ summary: "Register new Token" })
  @ApiResponse({
    status: 200,
    description: "Token Registred successfully",
    type: RegisterTokenDto,
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  registerToken(
    @Body() registerTokenDto: RegisterTokenDto
  ): Promise<RegisterTokenDto> {
    return this.notificationservice.registerToken(registerTokenDto);
  }

  @Post("send")
  @ApiOperation({ summary: "Send Notification to a device by token i" })
  @ApiResponse({
    status: 200,
    description: "Notification sent successfully",
    type: RegisterTokenDto,
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  sendNotification(
    @Body() sender: SenderNotificationDto
  ): Promise<NotificationDto> {
    return this.expoService.sendNotification(sender.token, sender.notification);
  }

  @Post()
  @ApiOperation({ summary: "Create a new Notification" })
  @ApiResponse({
    status: 201,
    description: "Notification created successfully",
    type: NotificationDto,
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  create(
    @Body() createNotificationDto: CreateNotificationDto
  ): Promise<NotificationDto> {
    return this.notificationservice.create(createNotificationDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all Notifications" })
  @ApiResponse({
    status: 200,
    description: "Return all Notifications",
    type: [NotificationDto],
  })
  findAll(): Promise<NotificationDto[]> {
    return this.notificationservice.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a Notification by ID" })
  @ApiResponse({
    status: 200,
    description: "Return the Notification",
    type: NotificationDto,
  })
  @ApiResponse({ status: 404, description: "Notification not found" })
  findOne(@Param("id") id: string): Promise<NotificationDto> {
    return this.notificationservice.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a Notification" })
  @ApiResponse({
    status: 200,
    description: "Notification updated successfully",
    type: NotificationDto,
  })
  @ApiResponse({ status: 404, description: "Notification not found" })
  update(
    @Param("id") id: string,
    @Body() updateNotificationDto: UpdateNotificationDto
  ): Promise<NotificationDto> {
    return this.notificationservice.update(id, updateNotificationDto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a Notification" })
  @ApiResponse({
    status: 200,
    description: "Notification deleted successfully",
  })
  @ApiResponse({ status: 404, description: "Notification not found" })
  remove(@Param("id") id: string): Promise<{ message: string }> {
    return this.notificationservice.remove(id);
  }
}
