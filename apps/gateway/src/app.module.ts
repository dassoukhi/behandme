import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { UsersModule } from "./users/users.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { SupabaseModule } from "./supabase/supabase.module.js";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter.js";
import { validate } from "./common/validators/env.validator.js";
import { ClerkClientProvider } from "./providers/clerk-client.provider.js";
import { ClerkAuthGuard } from "./auth/clerk-auth.guard.js";
import { APP_GUARD } from "@nestjs/core";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { ContractModule } from "./contracts/contract.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: [".env"],
    }),
    NotificationsModule,
    SupabaseModule,
    ContractModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
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
