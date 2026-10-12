import { Module } from '@nestjs/common';
import { UserChaincodeController } from './user-chaincode.controller.js';
import { UserChaincodeService } from './user-chaincode.service.js';
import { FabricModule } from '../fabric/fabric.module.js';

@Module({
  imports: [FabricModule],
  controllers: [UserChaincodeController],
  providers: [UserChaincodeService],
})
export class UserChaincodeModule {}
