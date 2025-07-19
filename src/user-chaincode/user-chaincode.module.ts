import { Module } from '@nestjs/common';
import { UserChaincodeController } from './user-chaincode.controller';
import { UserChaincodeService } from './user-chaincode.service';
import { FabricModule } from '../fabric/fabric.module';

@Module({
  imports: [FabricModule],
  controllers: [UserChaincodeController],
  providers: [UserChaincodeService],
})
export class UserChaincodeModule {}
