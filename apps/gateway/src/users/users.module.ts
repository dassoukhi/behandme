import { Module } from "@nestjs/common";
import { UsersService } from "./users.service.js";
import { UsersController } from "./users.controller.js";
import { ClerkClientProvider } from "../providers/clerk-client.provider.js";
import {
  ClerkIdentityProvider,
  IDENTITY_PROVIDER,
} from "./identity-provider.js";

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    ClerkClientProvider,
    { provide: IDENTITY_PROVIDER, useClass: ClerkIdentityProvider },
  ],
  exports: [UsersService],
})
export class UsersModule {}
