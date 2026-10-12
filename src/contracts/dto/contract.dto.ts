import { ApiProperty } from "@nestjs/swagger";

export class ContractDTO {
  @ApiProperty({
    description: "Unique identifier for the contract",
    example: "4bce1a03-3fa5-4d39-8c7e-7f3b7e3468a5",
  })
  id: string;

  @ApiProperty({
    description: "Current name of the contract",
    example: "networks",
    enum: ["networks", "devices", "storage"],
    default: "networks",
  })
  name: string;

  @ApiProperty({
    description: "Current Description of the contract",
    example:
      "Ce contrat contient des informations confidentielles transmises après validation.",
    default: "networks",
  })
  description: string;

  @ApiProperty({
    description: "Owner ID which references the users table",
    example: "user123",
  })
  owner_id: string;

  @ApiProperty({
    description: "Unique hash of the secret",
    example: "abc123def456...",
  })
  secret_hash: string;

  @ApiProperty({
    description: "Blockchain transaction ID for proof",
    example: "0xabc123...",
  })
  blockchain_tx_id: string;

  @ApiProperty({
    description: "Network on which the contract is stored",
    example: "Ethereum",
    enum: ["Ethereum", "Polygon", "Solana", "Fabric-Network"],
    default: "Fabric-Network",
  })
  blockchain_network: string;

  @ApiProperty({
    description: "Accessor ID which references the users table",
    example: "user456",
  })
  accessor_id?: string;

  @ApiProperty({
    description:
      "Array of validator IDs referencing the users table, maximum of 3 validators",
    isArray: true,
    example: ["validator1", "validator2"],
    maxItems: 3,
  })
  validators: string[];

  @ApiProperty({
    description: "Current status of the contract",
    example: "draft",
    enum: ["draft", "active", "validated", "released", "revoked"],
    default: "draft",
  })
  status: string;

  @ApiProperty({
    description: "Timestamp when the contract was created",
    example: "2023-10-12T07:20:50.52Z",
  })
  created_at: Date;

  @ApiProperty({
    description: "Timestamp when the contract was last updated",
    example: "2023-10-15T09:30:50.52Z",
  })
  updated_at: Date;

  @ApiProperty({
    description: "Additional metadata in JSON format",
    example: { key: "value" },
    type: "object",
    additionalProperties: true,
  })
  meta?: Record<string, any>;
}
