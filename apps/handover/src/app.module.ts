import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { HANDOVER_AUDIENCE } from "@lib/contracts";
import {
  DatabaseModule,
  GlobalExceptionFilter,
  HealthController,
  INTERNAL_AUTH_OPTIONS,
  InternalAuthGuard,
  serviceConfig,
} from "@lib/platform";
import { handoverEnv } from "./config.js";
import { ContractsModule } from "./contracts/contracts.module.js";

@Module({
  imports: [
    ConfigModule.forRoot(serviceConfig("handover", handoverEnv)),
    DatabaseModule.forRoot({ applicationName: "handover" }),
    ContractsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    {
      provide: INTERNAL_AUTH_OPTIONS,
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("INTERNAL_JWT_SECRET"),
        audience: HANDOVER_AUDIENCE,
      }),
      inject: [ConfigService],
    },
    { provide: APP_GUARD, useClass: InternalAuthGuard },
  ],
})
export class AppModule {}
