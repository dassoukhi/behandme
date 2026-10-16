import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClaimsService } from "./application/claims.service.js";
import { ContractsService } from "./application/contracts.service.js";
import { HandoverEvents } from "./application/handover-events.js";
import {
  CLOCK,
  CONTEST_OVERRIDE,
  HANDOVER_STORES,
  SEAL_CRYPTO,
  SHA256,
} from "./application/ports.js";
import { SealingService } from "./application/sealing.service.js";
import { systemClock } from "@lib/kernel";
import { contestOverrideMs } from "./domain/claims.js";
import { nodeSealCrypto } from "./infrastructure/node-seal-crypto.js";
import { KyselyHandoverStores } from "./infrastructure/kysely-handover.stores.js";
import { nodeSha256 } from "./infrastructure/sha256.js";
import { ContractsController } from "./interface/internal.controller.js";
import { HandoverMessaging } from "./interface/handover-messaging.js";

@Module({
  controllers: [ContractsController],
  providers: [
    ContractsService,
    SealingService,
    ClaimsService,
    HandoverEvents,
    HandoverMessaging,
    { provide: HANDOVER_STORES, useClass: KyselyHandoverStores },
    { provide: SHA256, useValue: nodeSha256 },
    { provide: SEAL_CRYPTO, useValue: nodeSealCrypto },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: CONTEST_OVERRIDE,
      useFactory: (config: ConfigService) =>
        contestOverrideMs(
          config.get<string>("CLAIM_CONTEST_SECONDS_OVERRIDE"),
          config.get<string>("NODE_ENV"),
        ),
      inject: [ConfigService],
    },
  ],
})
export class ContractsModule {}
