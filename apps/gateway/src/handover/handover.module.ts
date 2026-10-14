import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HANDOVER_CLIENT } from "./application/handover-client.js";
import {
  HANDOVER_HTTP_OPTIONS,
  HttpHandoverClient,
} from "./infrastructure/http-handover.client.js";

/** Provides HANDOVER_CLIENT to the modules that need contracts (contracts, users). */
@Module({
  providers: [
    {
      provide: HANDOVER_HTTP_OPTIONS,
      useFactory: (config: ConfigService) => ({
        baseUrl: config.getOrThrow<string>("HANDOVER_URL"),
        secret: config.getOrThrow<string>("INTERNAL_JWT_SECRET"),
      }),
      inject: [ConfigService],
    },
    { provide: HANDOVER_CLIENT, useClass: HttpHandoverClient },
  ],
  exports: [HANDOVER_CLIENT],
})
export class HandoverModule {}
