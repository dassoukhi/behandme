import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { ContractService } from "./contract.service";
import { ContractDTO } from "./dto/contract.dto";
import { CreateContractDTO } from "./dto/create-contract.dto";
import { UpdateContractDTO } from "./dto/update-contract.dto";
import { ContractValidatorsDTO } from "./dto/contractWtihValidators.dto";

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
  create(@Body() createContractDTO: CreateContractDTO): Promise<ContractDTO> {
    return this.contractService.create(createContractDTO);
  }

  @Get()
  @ApiOperation({ summary: "Get all contracts" })
  @ApiResponse({
    status: 200,
    description: "Return all contracts",
    type: [ContractDTO],
  })
  findAll(): Promise<ContractDTO[]> {
    return this.contractService.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a contract by ID" })
  @ApiResponse({
    status: 200,
    description: "Return the contract",
    type: ContractValidatorsDTO,
  })
  @ApiResponse({ status: 404, description: "Contract not found" })
  findOne(@Param("id") id: string): Promise<ContractValidatorsDTO> {
    return this.contractService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a contract" })
  @ApiResponse({
    status: 200,
    description: "Contract updated successfully",
    type: ContractDTO,
  })
  @ApiResponse({ status: 404, description: "Contract not found" })
  update(
    @Param("id") id: string,
    @Body() updateContractDTO: UpdateContractDTO
  ): Promise<ContractDTO> {
    return this.contractService.update(id, updateContractDTO);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a contract" })
  @ApiResponse({ status: 200, description: "Contract deleted successfully" })
  @ApiResponse({ status: 404, description: "Contract not found" })
  remove(@Param("id") id: string): Promise<{ message: string }> {
    return this.contractService.remove(id);
  }
}
