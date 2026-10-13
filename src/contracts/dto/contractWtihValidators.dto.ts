import { ApiProperty } from "@nestjs/swagger";
import { UserProfileDto } from "../../users/dto/user-profile.dto.js";
import { ContractDTO } from "./contract.dto.js";

export class ContractValidatorsDTO extends ContractDTO {
  @ApiProperty({
    description: "Validator profiles, in the order of `validators`",
    type: () => [UserProfileDto],
  })
  validators_list: UserProfileDto[];
}
