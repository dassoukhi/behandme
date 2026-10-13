import { PartialType, PickType } from "@nestjs/swagger";
import { CreateContractDTO } from "./create-contract.dto.js";

// Only descriptive metadata can be edited directly. Participants change through
// re-sealing, and the lifecycle (status) only through dedicated actions.
export class UpdateContractDTO extends PartialType(
  PickType(CreateContractDTO, ["name", "description"] as const),
) {}
