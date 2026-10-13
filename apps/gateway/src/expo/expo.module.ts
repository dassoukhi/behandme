import { Module } from "@nestjs/common";
import { ExpoService } from "./expo.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";

@Module({
  providers: [ExpoService, NotificationsService],
  exports: [ExpoService, NotificationsService],
})
export class ExpoModule {}
