import { Module } from "@nestjs/common";
import { ContractService } from "./contract.service.js";
import { ContractsController } from "./contract.controller.js";

@Module({
  controllers: [ContractsController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
