import { Module } from "@nestjs/common";
import type { Kysely } from "kysely";
import { DATABASE } from "@lib/platform";
import { HandoverModule } from "../handover/handover.module.js";
import { ClerkClientProvider } from "../providers/clerk-client.provider.js";
import {
  CONTRACT_PARTICIPATION,
  IDENTITY_PROVIDER,
  PROFILE_REPOSITORY,
  TRUST_REPOSITORY,
  USERS_UNIT_OF_WORK,
} from "./application/ports.js";
import { ProfileService } from "./application/profile.service.js";
import { TrustService } from "./application/trust.service.js";
import { ClerkIdentityProvider } from "./infrastructure/clerk-identity.provider.js";
import { HandoverParticipation } from "./infrastructure/handover-participation.js";
import { KyselyProfileRepository } from "./infrastructure/kysely-profile.repository.js";
import { KyselyTrustRepository } from "./infrastructure/kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "./infrastructure/kysely-users.unit-of-work.js";
import { UsersController } from "./interface/users.controller.js";

@Module({
  imports: [HandoverModule],
  controllers: [UsersController],
  providers: [
    ProfileService,
    TrustService,
    ClerkClientProvider,
    {
      provide: PROFILE_REPOSITORY,
      useFactory: (db: Kysely<any>) => new KyselyProfileRepository(db),
      inject: [DATABASE],
    },
    {
      provide: TRUST_REPOSITORY,
      useFactory: (db: Kysely<any>) => new KyselyTrustRepository(db),
      inject: [DATABASE],
    },
    { provide: USERS_UNIT_OF_WORK, useClass: KyselyUsersUnitOfWork },
    { provide: IDENTITY_PROVIDER, useClass: ClerkIdentityProvider },
    { provide: CONTRACT_PARTICIPATION, useClass: HandoverParticipation },
  ],
  exports: [TrustService, ProfileService],
})
export class UsersModule {}
