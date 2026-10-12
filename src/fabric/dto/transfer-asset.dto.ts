import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty } from "class-validator";

export class TransferAssetDto {
  @ApiProperty({
    description: "Nouveau propriétaire de l'asset",
    example: "Alice",
  })
  @IsString()
  @IsNotEmpty()
  newOwner: string;
}
