import { Module } from "@nestjs/common";
import { systemClock } from "@lib/kernel";
import { CLOCK, SCHEDULER_STORES } from "./application/ports.js";
import { SchedulerService } from "./application/scheduler.service.js";
import { KyselySchedulerStores } from "./infrastructure/kysely-scheduler.stores.js";
import { WorkerMessaging } from "./interface/worker-messaging.js";

@Module({
  providers: [
    SchedulerService,
    WorkerMessaging,
    { provide: CLOCK, useValue: systemClock },
    { provide: SCHEDULER_STORES, useClass: KyselySchedulerStores },
  ],
})
export class SchedulingModule {}
