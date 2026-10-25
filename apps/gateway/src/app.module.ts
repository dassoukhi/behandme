import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
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
import {
  RATE_LIMIT,
  UserThrottlerGuard,
} from "./common/throttle/user-throttler.guard.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      // .env.gateway first (e.g. DATABASE_URL, which differs between services), then the shared .env.
      envFilePath: [".env.gateway", ".env"],
    }),
    DatabaseModule.forRoot({ applicationName: "gateway" }),
    // Per instance: several gateway instances each count their own share.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: RATE_LIMIT.windowMs, limit: RATE_LIMIT.perMinute }],
      errorMessage: "Trop de requêtes : réessayez dans une minute.",
    }),
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
    // After ClerkAuthGuard, which sets the user the limit counts by.
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class AppModule {}
