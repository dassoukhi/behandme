import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NOTIFIER_CLIENT } from "./application/ports.js";
import {
  HttpNotifierClient,
  NOTIFIER_HTTP_OPTIONS,
  type NotifierHttpOptions,
} from "./infrastructure/http-notifier.client.js";
import { NotificationsController } from "./interface/notifications.controller.js";

@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFIER_HTTP_OPTIONS,
      useFactory: (config: ConfigService): NotifierHttpOptions => ({
        baseUrl: config.getOrThrow<string>("NOTIFIER_URL"),
        secret: config.getOrThrow<string>("INTERNAL_JWT_SECRET"),
      }),
      inject: [ConfigService],
    },
    { provide: NOTIFIER_CLIENT, useClass: HttpNotifierClient },
  ],
})
export class NotificationsModule {}
