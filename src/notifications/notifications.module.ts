import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { ConstraintsModule } from "@/contraints/contraint.module";
import { ExpoModule } from "@/expo/expo.module";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ExpoModule],
  exports: [NotificationsService, ExpoModule],
  imports: [ExpoModule, ConstraintsModule],
})
export class NotificationsModule {}
