import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { ExpoModule } from "../expo/expo.module.js";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ExpoModule],
  exports: [NotificationsService, ExpoModule],
  imports: [ExpoModule],
})
export class NotificationsModule {}
