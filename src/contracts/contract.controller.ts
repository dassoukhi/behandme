import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { ContractService } from "./contract.service.js";
import { ContractDTO } from "./dto/contract.dto.js";
import { CreateContractDTO } from "./dto/create-contract.dto.js";
import { UpdateContractDTO } from "./dto/update-contract.dto.js";
import { ContractValidatorsDTO } from "./dto/contractWtihValidators.dto.js";
import { CurrentUserId } from "../auth/current-user.decorator.js";

@ApiTags("contracts")
@ApiBearerAuth()
@Controller("contracts")
export class ContractsController {
  constructor(private readonly contractService: ContractService) {}

  @Post()
  @ApiOperation({ summary: "Create a new Contract" })
  @ApiResponse({
    status: 201,
    description: "Contract created successfully",
    type: ContractDTO,
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  create(
    @CurrentUserId() me: string,
    @Body() createContractDTO: CreateContractDTO,
  ): Promise<ContractDTO> {
    return this.contractService.create(me, createContractDTO);
  }

  @Get()
  @ApiOperation({
    summary: "List the contracts the caller owns, accesses or validates",
  })
  @ApiResponse({
    status: 200,
    description: "Return all contracts",
    type: [ContractDTO],
  })
  findAll(@CurrentUserId() me: string): Promise<ContractDTO[]> {
    return this.contractService.findAll(me);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a contract by ID" })
  @ApiResponse({
    status: 200,
    description: "Return the contract",
    type: ContractValidatorsDTO,
  })
  @ApiResponse({ status: 404, description: "Contract not found" })
  findOne(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ContractValidatorsDTO> {
    return this.contractService.findOne(me, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a contract (owner only)" })
  @ApiResponse({
    status: 200,
    description: "Contract updated successfully",
    type: ContractDTO,
  })
  @ApiResponse({ status: 404, description: "Contract not found" })
  update(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() updateContractDTO: UpdateContractDTO,
  ): Promise<ContractDTO> {
    return this.contractService.update(me, id, updateContractDTO);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a contract (owner only)" })
  @ApiResponse({ status: 200, description: "Contract deleted successfully" })
  @ApiResponse({ status: 404, description: "Contract not found" })
  remove(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.contractService.remove(me, id);
  }
}
