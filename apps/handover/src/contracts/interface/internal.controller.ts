import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import type {
  AuditEvent,
  ChainVerification,
  ContractRecord,
} from "@lib/contracts";
import { ForUser } from "@lib/platform";
import { ContractsService } from "../application/contracts.service.js";
import { ContractChangesDto, NewContractDto } from "./dto/inputs.dto.js";

// Internal API, called by the gateway only (internal token, whose subject is the user). The gateway
// has already checked that the participants of a new contract are people the user trusts.

@Controller("contracts")
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  list(@ForUser() me: string): Promise<ContractRecord[]> {
    return this.contracts.list(me);
  }

  @Post()
  create(
    @ForUser() me: string,
    @Body() body: NewContractDto,
  ): Promise<ContractRecord> {
    return this.contracts.create(me, {
      category: body.category,
      description: body.description ?? null,
      accessorId: body.accessor_id,
      validatorIds: body.validator_ids,
    });
  }

  @Get(":id")
  get(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ContractRecord> {
    return this.contracts.get(me, id);
  }

  @Patch(":id")
  update(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() changes: ContractChangesDto,
  ): Promise<ContractRecord> {
    return this.contracts.update(me, id, changes);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.contracts.remove(me, id);
  }

  @Get(":id/events")
  events(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AuditEvent[]> {
    return this.contracts.events(me, id);
  }

  @Get(":id/events/verify")
  verify(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ChainVerification> {
    return this.contracts.verify(me, id);
  }
}
