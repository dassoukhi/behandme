import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNumber, IsNotEmpty, Min } from "class-validator";

export class UpdateAssetDto {
  @ApiProperty({
    description: "Couleur de l'asset",
    example: "red",
  })
  @IsString()
  @IsNotEmpty()
  color: string;

  @ApiProperty({
    description: "Taille de l'asset",
    example: 10,
  })
  @IsNumber()
  @Min(1)
  size: number;

  @ApiProperty({
    description: "Propriétaire de l'asset",
    example: "Brad",
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiProperty({
    description: "Valeur estimée de l'asset",
    example: 400,
  })
  @IsNumber()
  @Min(0)
  appraisedValue: number;
}
