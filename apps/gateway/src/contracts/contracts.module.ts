import { Module } from "@nestjs/common";
import { HandoverModule } from "../handover/handover.module.js";
import { KeysModule } from "../keys/keys.module.js";
import { UsersModule } from "../users/users.module.js";
import { ContractsFacade } from "./application/contracts.facade.js";
import { ContractsController } from "./interface/contracts.controller.js";

@Module({
  imports: [HandoverModule, UsersModule, KeysModule],
  controllers: [ContractsController],
  providers: [ContractsFacade],
})
export class ContractsModule {}
