import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNumber, IsNotEmpty, Min } from "class-validator";

export class CreateAssetDto {
  @ApiProperty({
    description: "Identifiant unique de l'asset",
    example: "asset1",
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: "Couleur de l'asset",
    example: "blue",
  })
  @IsString()
  @IsNotEmpty()
  color: string;

  @ApiProperty({
    description: "Taille de l'asset",
    example: 5,
  })
  @IsNumber()
  @Min(1)
  size: number;

  @ApiProperty({
    description: "Propriétaire de l'asset",
    example: "Tomoko",
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiProperty({
    description: "Valeur estimée de l'asset",
    example: 300,
  })
  @IsNumber()
  @Min(0)
  appraisedValue: number;
}
