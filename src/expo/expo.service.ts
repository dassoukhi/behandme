import { CreateNotificationDto } from "../notifications/dto/create-notifications.dto.js";
import { NotificationDto } from "../notifications/dto/notifications.dto.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Expo, ExpoPushMessage } from "expo-server-sdk";

@Injectable()
export class ExpoService {
  private expo: Expo;

  constructor(private readonly notificationService: NotificationsService) {
    this.expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  }

  async sendNotification(
    token: string,
    notification: CreateNotificationDto
  ): Promise<NotificationDto> {
    if (!Expo.isExpoPushToken(token)) {
      throw new HttpException(
        "Invalid Expo push token.",
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      const savedNotif = await this.notificationService.create(notification);

      const message: ExpoPushMessage = {
        to: token,
        sound: "default",
        title: notification.title,
        body: notification.message,
        data: { withSome: "data" },
        richContent: {
          image: "../images/behindme_logo_black.png",
        },
        icon: "../images/behindme_logo_black.png",
      };

      await this.expo.sendPushNotificationsAsync([message]);

      return savedNotif;
    } catch (error) {
      // Assuming create() or sendPushNotificationsAsync can throw an error
      throw new HttpException(
        `An error occurred while sending notification: ${error.message || "Unknown error"}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
