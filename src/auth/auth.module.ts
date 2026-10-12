import { Module } from "@nestjs/common";
import { ClerkStrategy } from "./clerk.strategy.js";
import { PassportModule } from "@nestjs/passport";
import { ClerkClientProvider } from "../providers/clerk-client.provider.js";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [PassportModule, ConfigModule],
  providers: [ClerkStrategy, ClerkClientProvider],
  exports: [PassportModule],
})
export class AuthModule {}
