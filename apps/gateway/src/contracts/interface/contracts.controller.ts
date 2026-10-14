import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUserId } from "../../auth/current-user.decorator.js";
import { ContractsFacade } from "../application/contracts.facade.js";
import {
  ChainVerificationDTO,
  ContractDetailDTO,
  ContractDTO,
  ContractEventDTO,
} from "./dto/contract.dto.js";
import {
  CreateContractDTO,
  UpdateContractDTO,
} from "./dto/contract-inputs.dto.js";

// Served by the handover service. A contract the caller takes no part in answers 404.
@ApiTags("contracts")
@ApiBearerAuth()
@ApiResponse({
  status: 503,
  description: "The handover service is unavailable",
})
@Controller("contracts")
export class ContractsController {
  constructor(private readonly contracts: ContractsFacade) {}

  @Post()
  @ApiOperation({ summary: "Create a draft contract owned by the caller" })
  @ApiResponse({ status: 201, type: ContractDetailDTO })
  @ApiResponse({
    status: 400,
    description: "Invalid or untrusted participants",
  })
  create(
    @CurrentUserId() me: string,
    @Body() body: CreateContractDTO,
  ): Promise<ContractDetailDTO> {
    return this.contracts.create(me, body);
  }

  @Get()
  @ApiOperation({
    summary:
      "List the contracts the caller owns, accesses or validates, newest first",
  })
  @ApiResponse({ status: 200, type: [ContractDTO] })
  findAll(@CurrentUserId() me: string): Promise<ContractDTO[]> {
    return this.contracts.list(me);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a contract with its participants" })
  @ApiResponse({ status: 200, type: ContractDetailDTO })
  @ApiResponse({ status: 404, description: "Contract not found" })
  findOne(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ContractDetailDTO> {
    return this.contracts.get(me, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change the category or description (owner)" })
  @ApiResponse({ status: 200, type: ContractDetailDTO })
  @ApiResponse({ status: 404, description: "Contract not found" })
  @ApiResponse({ status: 409, description: "Not possible in this status" })
  update(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() changes: UpdateContractDTO,
  ): Promise<ContractDetailDTO> {
    return this.contracts.update(me, id, changes);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a draft (owner); its audit log stays" })
  @ApiResponse({ status: 200, description: "Contract deleted" })
  @ApiResponse({ status: 404, description: "Contract not found" })
  @ApiResponse({ status: 409, description: "Only a draft can be deleted" })
  async remove(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    await this.contracts.remove(me, id);
    return { message: "Contract deleted" };
  }

  @Get(":id/events")
  @ApiOperation({
    summary:
      "The contract's audit log, oldest first (hash chain the app can verify)",
  })
  @ApiResponse({ status: 200, type: [ContractEventDTO] })
  @ApiResponse({ status: 404, description: "Contract not found" })
  events(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ContractEventDTO[]> {
    return this.contracts.events(me, id);
  }

  @Get(":id/events/verify")
  @ApiOperation({ summary: "Check the contract's audit log on the server" })
  @ApiResponse({ status: 200, type: ChainVerificationDTO })
  @ApiResponse({ status: 404, description: "Contract not found" })
  verify(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ChainVerificationDTO> {
    return this.contracts.verify(me, id);
  }
}
