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
  SealedMaterialDTO,
} from "./dto/contract.dto.js";
import {
  CreateContractDTO,
  RevokeContractDTO,
  SealContractDTO,
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

  @Post(":id/seal")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Seal or re-seal the contract (owner): the encrypted secret, the wrapped key and shares, and the signed manifest",
  })
  @ApiResponse({ status: 200, type: ContractDetailDTO })
  @ApiResponse({
    status: 400,
    description: "The sealed material or its signature does not check out",
  })
  @ApiResponse({ status: 404, description: "Contract not found" })
  @ApiResponse({
    status: 409,
    description:
      "The contract or someone's keys changed meanwhile: reload and seal again",
  })
  seal(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SealContractDTO,
  ): Promise<ContractDetailDTO> {
    return this.contracts.seal(me, id, body);
  }

  @Get(":id/sealed")
  @ApiOperation({
    summary:
      "What the caller's role may download of the sealed contract (owner: envelope and key; validator: their share; accessor: the manifest until release)",
  })
  @ApiResponse({ status: 200, type: SealedMaterialDTO })
  @ApiResponse({ status: 404, description: "Contract not found or not sealed" })
  sealed(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SealedMaterialDTO> {
    return this.contracts.sealed(me, id);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @ApiOperation({
    summary: "Revoke the contract (owner): every ciphertext is deleted",
  })
  @ApiResponse({ status: 200, type: ContractDetailDTO })
  @ApiResponse({ status: 404, description: "Contract not found" })
  @ApiResponse({
    status: 409,
    description: "Not possible in this status, or the contract changed",
  })
  revoke(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() { expected_version }: RevokeContractDTO,
  ): Promise<ContractDetailDTO> {
    return this.contracts.revoke(me, id, expected_version);
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
