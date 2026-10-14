import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import {
  DatabaseModule,
  GlobalExceptionFilter,
  HealthController,
  serviceConfig,
} from "@lib/platform";
import { workerEnv } from "./config.js";
import { SchedulingModule } from "./scheduling/scheduling.module.js";

@Module({
  imports: [
    ConfigModule.forRoot(serviceConfig("worker", workerEnv)),
    DatabaseModule.forRoot({ applicationName: "worker" }),
    SchedulingModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
