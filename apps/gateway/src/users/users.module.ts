import { Module } from "@nestjs/common";
import type { Kysely } from "kysely";
import { systemClock } from "@lib/kernel";
import { DATABASE } from "@lib/platform";
import { HandoverModule } from "../handover/handover.module.js";
import { ClerkClientProvider } from "../providers/clerk-client.provider.js";
import {
  CONTACT_CODE_REPOSITORY,
  IDENTITY_PROVIDER,
  INVITATION_REPOSITORY,
  PROFILE_REPOSITORY,
  TRUST_REPOSITORY,
  USERS_CLOCK,
  USERS_UNIT_OF_WORK,
} from "./application/ports.js";
import { ContactCodeService } from "./application/contact-code.service.js";
import { InvitationService } from "./application/invitation.service.js";
import { ProfileService } from "./application/profile.service.js";
import { TrustService } from "./application/trust.service.js";
import { ClerkIdentityProvider } from "./infrastructure/clerk-identity.provider.js";
import { KyselyContactCodeRepository } from "./infrastructure/kysely-contact-code.repository.js";
import { KyselyInvitationRepository } from "./infrastructure/kysely-invitation.repository.js";
import { KyselyProfileRepository } from "./infrastructure/kysely-profile.repository.js";
import { KyselyTrustRepository } from "./infrastructure/kysely-trust.repository.js";
import { KyselyUsersUnitOfWork } from "./infrastructure/kysely-users.unit-of-work.js";
import { InvitationsController } from "./interface/invitations.controller.js";
import { UsersController } from "./interface/users.controller.js";

@Module({
  imports: [HandoverModule],
  controllers: [UsersController, InvitationsController],
  providers: [
    ProfileService,
    TrustService,
    InvitationService,
    ContactCodeService,
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
    {
      provide: INVITATION_REPOSITORY,
      useFactory: (db: Kysely<any>) => new KyselyInvitationRepository(db),
      inject: [DATABASE],
    },
    {
      provide: CONTACT_CODE_REPOSITORY,
      useFactory: (db: Kysely<any>) => new KyselyContactCodeRepository(db),
      inject: [DATABASE],
    },
    { provide: USERS_CLOCK, useValue: systemClock },
    KyselyUsersUnitOfWork,
    { provide: USERS_UNIT_OF_WORK, useExisting: KyselyUsersUnitOfWork },
    { provide: IDENTITY_PROVIDER, useClass: ClerkIdentityProvider },
  ],
  exports: [
    TrustService,
    ProfileService,
    ContactCodeService,
    KyselyUsersUnitOfWork,
  ],
})
export class UsersModule {}
