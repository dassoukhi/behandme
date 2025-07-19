import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
