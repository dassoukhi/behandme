import { Module } from "@nestjs/common";
import { ContractService } from "./contract.service";
import { ContractsController } from "./contract.controller";

@Module({
  controllers: [ContractsController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
