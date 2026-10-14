import { Module } from "@nestjs/common";
import { ClerkClientProvider } from "../providers/clerk-client.provider.js";
import {
  IDENTITY_PROVIDER,
  PROFILE_REPOSITORY,
  TRUST_REPOSITORY,
} from "./application/ports.js";
import { ProfileService } from "./application/profile.service.js";
import { TrustService } from "./application/trust.service.js";
import { ClerkIdentityProvider } from "./infrastructure/clerk-identity.provider.js";
import { SupabaseProfileRepository } from "./infrastructure/supabase-profile.repository.js";
import { SupabaseTrustRepository } from "./infrastructure/supabase-trust.repository.js";
import { UsersController } from "./interface/users.controller.js";

@Module({
  controllers: [UsersController],
  providers: [
    ProfileService,
    TrustService,
    ClerkClientProvider,
    { provide: PROFILE_REPOSITORY, useClass: SupabaseProfileRepository },
    { provide: TRUST_REPOSITORY, useClass: SupabaseTrustRepository },
    { provide: IDENTITY_PROVIDER, useClass: ClerkIdentityProvider },
  ],
  exports: [TrustService],
})
export class UsersModule {}
