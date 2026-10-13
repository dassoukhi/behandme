import { Module } from "@nestjs/common";
import { ContractService } from "./contract.service.js";
import { ContractsController } from "./contract.controller.js";
import { UsersModule } from "../users/users.module.js";

@Module({
  imports: [UsersModule],
  controllers: [ContractsController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
