import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SupabaseModule } from './supabase/supabase.module';
import { FabricModule } from './fabric/fabric.module';
import { UserChaincodeModule } from './user-chaincode/user-chaincode.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { validate } from './common/validators/env.validator';
import { DocumentController } from './documents/documents.controller';
import { ClerkClientProvider } from 'src/providers/clerk-client.provider';
import { ClerkAuthGuard } from './auth/clerk-auth.guard';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ['.env'],
    }),
    SupabaseModule,
    UsersModule,
    AuthModule,
    FabricModule,
    UserChaincodeModule,
  ],
  controllers: [AppController, DocumentController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    ClerkClientProvider, {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    }
  ],
})
export class AppModule {}
