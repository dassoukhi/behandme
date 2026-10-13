import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateUserDto } from "./create-user.dto.js";

// The id is the Clerk user ID and cannot be changed.
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ["id"] as const),
) {}
