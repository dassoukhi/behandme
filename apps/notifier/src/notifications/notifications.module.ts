import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { systemClock } from "@lib/kernel";
import { DeliveryService } from "./application/delivery.service.js";
import { EmailDeliveryService } from "./application/email-delivery.service.js";
import { InboxService } from "./application/inbox.service.js";
import { NotificationEvents } from "./application/notification-events.js";
import { NotifyService } from "./application/notify.service.js";
import {
  CLOCK,
  EMAIL_GATEWAY,
  NOTIFIER_STORES,
  PUSH_GATEWAY,
} from "./application/ports.js";
import {
  EXPO_ACCESS_TOKEN,
  ExpoPushGateway,
} from "./infrastructure/expo-push.gateway.js";
import { KyselyNotifierStores } from "./infrastructure/kysely-notifier.stores.js";
import {
  disabledEmailGateway,
  ResendEmailGateway,
} from "./infrastructure/resend-email.gateway.js";
import {
  InboxController,
  PreferencesController,
  PushTokensController,
} from "./interface/internal.controller.js";
import { NotifierMessaging } from "./interface/notifier-messaging.js";

@Module({
  controllers: [InboxController, PushTokensController, PreferencesController],
  providers: [
    InboxService,
    NotifyService,
    NotificationEvents,
    DeliveryService,
    EmailDeliveryService,
    NotifierMessaging,
    { provide: CLOCK, useValue: systemClock },
    { provide: NOTIFIER_STORES, useClass: KyselyNotifierStores },
    {
      provide: EXPO_ACCESS_TOKEN,
      useFactory: (config: ConfigService) => config.get("EXPO_ACCESS_TOKEN"),
      inject: [ConfigService],
    },
    { provide: PUSH_GATEWAY, useClass: ExpoPushGateway },
    {
      provide: EMAIL_GATEWAY,
      useFactory: (config: ConfigService) => {
        const key = config.get<string>("RESEND_API_KEY");
        return key
          ? new ResendEmailGateway(new Resend(key), config.get("EMAIL_FROM")!)
          : disabledEmailGateway;
      },
      inject: [ConfigService],
    },
  ],
})
export class NotificationsModule {}
