import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateContractDTO {
  @ApiProperty({
    description: "Name of Contracts",
    example: "networks",
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: "Description of Contracts",
    example: "My description",
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: "Owner ID which references the users table",
    example: "user123",
  })
  @IsString()
  @IsNotEmpty()
  owner_id: string;

  @ApiProperty({
    description: "Unique hash of the secret",
    example: "abc123def456...",
  })
  @IsString()
  @IsNotEmpty()
  secret_hash: string;

  @ApiProperty({
    description: "Blockchain transaction ID for proof",
    example: "0xabc123...",
  })
  @IsString()
  @IsNotEmpty()
  blockchain_tx_id: string;

  @ApiProperty({
    description: "Network on which the contract is stored",
    example: "Ethereum",
    enum: ["Ethereum", "Polygon", "Solana", "Fabric-Network"],
  })
  @IsEnum(["Ethereum", "Polygon", "Solana", "Fabric-Network"])
  @IsOptional()
  blockchain_network?: string = "Fabric-Network";

  @ApiProperty({
    description: "Accessor ID which references the users table",
    example: "user456",
  })
  @IsNotEmpty()
  @IsString()
  accessor_id: string;

  @ApiProperty({
    description:
      "Array of validator IDs referencing the users table, maximum of 3 validators",
    isArray: true,
    example: ["validator1", "validator2"],
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(3, { each: true })
  validators: string[];

  @ApiProperty({
    description: "Current status of the contract",
    example: "draft",
    enum: ["draft", "active", "validated", "released", "revoked"],
    default: "draft",
  })
  @IsOptional()
  @IsEnum(["draft", "active", "validated", "released", "revoked"])
  status?: string;

  @ApiProperty({
    description: "Additional metadata in JSON format",
    example: { key: "value" },
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  meta?: Record<string, any>;
}
