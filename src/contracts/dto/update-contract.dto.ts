import { PartialType } from "@nestjs/swagger";
import { CreateContractDTO } from "./create-contract.dto.js";

export class UpdateContractDTO extends PartialType(CreateContractDTO) {}
