import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import {
  DatabaseModule,
  GlobalExceptionFilter,
  HealthController,
} from "@lib/platform";
import { UsersModule } from "./users/users.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { validate } from "./common/validators/env.validator.js";
import { ClerkClientProvider } from "./providers/clerk-client.provider.js";
import { ClerkAuthGuard } from "./auth/clerk-auth.guard.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { ContractsModule } from "./contracts/contracts.module.js";
import { KeysModule } from "./keys/keys.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      // .env.gateway first (e.g. DATABASE_URL, which differs between services), then the shared .env.
      envFilePath: [".env.gateway", ".env"],
    }),
    DatabaseModule.forRoot({ applicationName: "gateway" }),
    NotificationsModule,
    ContractsModule,
    KeysModule,
    UsersModule,
    AuthModule,
    MessagingModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    ClerkClientProvider,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
  ],
})
export class AppModule {}
