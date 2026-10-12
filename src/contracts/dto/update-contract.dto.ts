import { PartialType } from "@nestjs/mapped-types";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { CreateContractDTO } from "./create-contract.dto"; // Assuming this is the path to the file

export class UpdateContractDTO extends PartialType(CreateContractDTO) {
  @ApiPropertyOptional({
    description: "Additional metadata in JSON format",
    example: { key: "value" },
  })
  meta?: Record<string, any>;
}
