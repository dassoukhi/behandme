import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { ClerkStrategy } from './clerk.strategy.js';
import { PassportModule } from '@nestjs/passport';
import { ClerkClientProvider } from '../providers/clerk-client.provider.js';
import { ConfigModule } from '@nestjs/config';


@Module({
  imports: [PassportModule, ConfigModule],
  controllers: [AuthController],
  providers: [AuthService, ClerkStrategy, ClerkClientProvider],
  exports: [AuthService, PassportModule],
})
export class AuthModule {}