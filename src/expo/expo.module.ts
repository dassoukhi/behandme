import { Module } from "@nestjs/common";
import { ExpoService } from "./expo.service";
import { NotificationsService } from "@/notifications/notifications.service";

@Module({
  providers: [ExpoService, NotificationsService],
  exports: [ExpoService, NotificationsService],
})
export class ExpoModule {}
