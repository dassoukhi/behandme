import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { NOTIFIER_AUDIENCE } from "@lib/contracts";
import {
  correlationMiddleware,
  DatabaseModule,
  GlobalExceptionFilter,
  HealthController,
  INTERNAL_AUTH_OPTIONS,
  InternalAuthGuard,
  serviceConfig,
} from "@lib/platform";
import { notifierEnv } from "./config.js";
import { NotificationsModule } from "./notifications/notifications.module.js";

@Module({
  imports: [
    ConfigModule.forRoot(serviceConfig("notifier", notifierEnv)),
    DatabaseModule.forRoot({ applicationName: "notifier" }),
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    {
      provide: INTERNAL_AUTH_OPTIONS,
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("INTERNAL_JWT_SECRET"),
        audience: NOTIFIER_AUDIENCE,
      }),
      inject: [ConfigService],
    },
    { provide: APP_GUARD, useClass: InternalAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationMiddleware).forRoutes("*");
  }
}
