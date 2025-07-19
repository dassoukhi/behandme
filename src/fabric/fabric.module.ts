import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FabricService } from './fabric.service';
import { FabricController } from './fabric.controller';

@Module({
  imports: [ConfigModule],
  providers: [FabricService],
  controllers: [],
  exports: [FabricService],
})
export class FabricModule {}
