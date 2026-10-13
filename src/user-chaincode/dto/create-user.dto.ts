import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

// The ledger user id is the authenticated caller, never taken from the body.
export class CreateChaincodeUserDto {
  @ApiProperty({ description: "status", example: "active" })
  @IsString()
  status: string;
}
