import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty } from "class-validator";

export class CreateDocumentDto {
  @ApiProperty({
    description: "Document ID (UUID)",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: "Title",
    example: "Contrat de Vente",
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: "type",
    example: "contract",
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: "Description du contrat",
    example: "Contenu du contrat de vente...",
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: "proprietaire",
    example: "user1",
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiProperty({
    description: "Type de document",
    example: "user2",
  })
  @IsString()
  @IsNotEmpty()
  docType: string;

  @ApiProperty({
    description: "statut",
    example: "active",
  })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiProperty({
    description: "hash du doccument",
    example: "3445chgfgh666",
  })
  @IsString()
  @IsNotEmpty()
  hash: string;
}

export class UpdateDocumentDto {
  @ApiProperty({
    description: "Document ID (UUID)",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  @IsString()
  @IsNotEmpty()
  Id: string;

  @ApiProperty({
    description: "Title",
    example: "Contrat de Vente",
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: "type",
    example: "contract",
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: "Description du contrat",
    example: "Contenu du contrat de vente...",
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: "proprietaire",
    example: "user1",
  })
  @IsString()
  @IsNotEmpty()
  owner: string;

  @ApiProperty({
    description: "hash du doccument",
    example: "3445chgfgh666",
  })
  @IsString()
  @IsNotEmpty()
  hash: string;

  @ApiProperty({
    description: "Type de document",
    example: "user2",
  })
  @IsString()
  @IsNotEmpty()
  docType: string;

  @ApiProperty({
    description: "statut",
    example: "active",
  })
  @IsString()
  @IsNotEmpty()
  status: string;
}

export class TransferDocumentDto {
  @ApiProperty({
    description: "Document ID (UUID)",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @ApiProperty({
    description: "ancien proprietaire",
    example: "user1",
  })
  @IsString()
  @IsNotEmpty()
  oldOwner: string;

  @ApiProperty({
    description: "nouveau proprietaire",
    example: "user1",
  })
  @IsString()
  @IsNotEmpty()
  newOwner: string;
}
