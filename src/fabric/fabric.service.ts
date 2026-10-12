import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as grpc from "@grpc/grpc-js";
import {
  connect,
  Gateway,
  GatewayError,
  hash,
  Network,
  signers,
} from "@hyperledger/fabric-gateway";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";

// Same surface as the former fabric-network Contract: results come back as
// Buffers, so callers can keep using result.toString().
interface FabricContract {
  submitTransaction(name: string, ...args: string[]): Promise<Buffer>;
  evaluateTransaction(name: string, ...args: string[]): Promise<Buffer>;
}

@Injectable()
export class FabricService implements OnModuleInit {
  private readonly logger = new Logger(FabricService.name);
  private client: grpc.Client;
  private gateway: Gateway;
  private network: Network;
  private readonly contractName = "user-transfer-basic";

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      await this.initializeFabricNetwork();
      this.logger.log("Fabric network initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Fabric network", error);
    }
  }

  private async initializeFabricNetwork() {
    const orgPath = path.resolve(
      process.cwd(),
      "fabric-network",
      "fabric-samples",
      "test-network",
      "organizations",
      "peerOrganizations",
      "org1.example.com"
    );
    const ccpPath = path.join(orgPath, "connection-org1.json");

    if (!fs.existsSync(ccpPath)) {
      throw new Error(`Connection profile not found at ${ccpPath}`);
    }

    const ccp = JSON.parse(fs.readFileSync(ccpPath, "utf8"));
    const peer = ccp.peers["peer0.org1.example.com"];
    const peerEndpoint = peer.url.replace(/^grpcs:\/\//, "");

    const credPath = path.join(orgPath, "users", "Admin@org1.example.com");
    const certPath = path.join(credPath, "msp", "signcerts", "cert.pem");
    const keyPath = path.join(credPath, "msp", "keystore");

    if (!fs.existsSync(certPath)) {
      throw new Error(`Certificate not found at ${certPath}`);
    }

    const keyFile = fs.readdirSync(keyPath)[0];
    const privateKey = crypto.createPrivateKey(
      fs.readFileSync(path.join(keyPath, keyFile))
    );

    this.client = new grpc.Client(
      peerEndpoint,
      grpc.credentials.createSsl(Buffer.from(peer.tlsCACerts.pem)),
      {
        "grpc.ssl_target_name_override":
          peer.grpcOptions["ssl-target-name-override"],
      }
    );

    this.gateway = connect({
      client: this.client,
      identity: { mspId: "Org1MSP", credentials: fs.readFileSync(certPath) },
      signer: signers.newPrivateKeySigner(privateKey),
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),
      submitOptions: () => ({ deadline: Date.now() + 5000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });

    this.network = this.gateway.getNetwork("mychannel");

    // The connection is lazy: check the peer without blocking startup. The
    // gRPC client keeps reconnecting, so calls work once the peer is up.
    this.client.waitForReady(Date.now() + 5000, (error) => {
      if (error) {
        this.logger.warn(
          `Fabric peer ${peerEndpoint} unreachable: ${error.message}`
        );
      } else {
        this.logger.log(`Connected to Fabric peer ${peerEndpoint}`);
      }
    });
  }

  private getContract(contractName: string): FabricContract {
    if (!this.network) {
      throw new Error(
        "Fabric network not initialized. Please check the connection."
      );
    }
    const contract = this.network.getContract(contractName);
    return {
      submitTransaction: (name, ...args) =>
        this.withFabricErrors(() => contract.submitTransaction(name, ...args)),
      evaluateTransaction: (name, ...args) =>
        this.withFabricErrors(() =>
          contract.evaluateTransaction(name, ...args)
        ),
    };
  }

  // Gateway errors only say "see attached details": surface the smart
  // contract messages so callers can keep matching on error.message.
  private async withFabricErrors(
    transaction: () => Promise<Uint8Array>
  ): Promise<Buffer> {
    try {
      return Buffer.from(await transaction());
    } catch (error) {
      if (!(error instanceof GatewayError) || error.details.length === 0) {
        throw error;
      }
      const messages = new Set(
        error.details.map((detail) =>
          detail.message.replace(/^chaincode response \d+, /, "")
        )
      );
      throw new Error([...messages].join("; "), { cause: error });
    }
  }

  async submitTransaction(
    contractName: string,
    functionName: string,
    ...args: string[]
  ): Promise<string> {
    const contract = this.getContract(contractName);
    try {
      const result = await contract.submitTransaction(functionName, ...args);
      this.logger.log(
        `Transaction ${functionName} for contract ${contractName} submitted successfully`
      );
      return result.toString();
    } catch (error) {
      this.logger.error(
        `Failed to submit transaction ${functionName} for contract ${contractName}`,
        error
      );
      throw error;
    }
  }

  async evaluateTransaction(
    contractName: string,
    functionName: string,
    ...args: string[]
  ): Promise<any> {
    const contract = this.getContract(contractName);
    try {
      const result = await contract.evaluateTransaction(functionName, ...args);
      this.logger.log(
        `Transaction ${functionName} for contract ${contractName} evaluated successfully`
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        `Failed to evaluate transaction ${functionName} for contract ${contractName}`,
        error
      );
      throw error;
    }
  }

  async disconnect() {
    if (this.gateway) {
      this.gateway.close();
      this.client.close();
      this.logger.log("Fabric gateway disconnected");
    }
  }

  // ===== GESTION DES UTILISATEURS =====

  async createUser(id: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction("CreateUser", id);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de la création de l'utilisateur", error);
      throw error;
    }
  }

  async readUser(id: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction("ReadUser", id);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de la lecture de l'utilisateur", error);
      throw error;
    }
  }

  async updateUser(id: string, status: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction("UpdateUser", id, status);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la mise à jour de l'utilisateur",
        error
      );
      throw error;
    }
  }

  async deleteUser(id: string): Promise<void> {
    const contract = this.getContract(this.contractName);
    try {
      await contract.submitTransaction("DeleteUser", id);
    } catch (error) {
      this.logger.error(
        "Erreur lors de la suppression de l'utilisateur",
        error
      );
      throw error;
    }
  }

  async getAllUsers(): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction("GetAllUsers");
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la récupération des utilisateurs",
        error
      );
      throw error;
    }
  }

  async getUsersByStatus(status: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction(
        "GetUsersByStatus",
        status
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la récupération des utilisateurs par statut",
        error
      );
      throw error;
    }
  }

  // ===== GESTION DES DOCUMENTS =====

  async createDocument(
    id: string,
    title: string,
    type: string,
    content: string,
    owner: string,
    hash: string
  ): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction(
        "CreateDocument",
        id,
        title,
        type,
        content,
        owner,
        hash
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de la création du document", error);
      throw error;
    }
  }

  async readDocument(id: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction("ReadDocument", id);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de la lecture du document", error);
      throw error;
    }
  }

  async updateDocument(
    id: string,
    title: string,
    type: string,
    content: string,
    status: string,
    hash: string
  ): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction(
        "UpdateDocument",
        id,
        title,
        type,
        content,
        status,
        hash
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de la mise à jour du document", error);
      throw error;
    }
  }

  async deleteDocument(id: string): Promise<void> {
    const contract = this.getContract(this.contractName);
    try {
      await contract.submitTransaction("DeleteDocument", id);
    } catch (error) {
      this.logger.error("Erreur lors de la suppression du document", error);
      throw error;
    }
  }

  async transferDocument(documentId: string, newOwner: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction(
        "TransferDocument",
        documentId,
        newOwner
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors du transfert du document", error);
      throw error;
    }
  }

  async getAllDocuments(): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction("GetAllDocuments");
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de la récupération des documents", error);
      throw error;
    }
  }

  async getDocumentsByOwner(owner: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction(
        "GetDocumentsByOwner",
        owner
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la récupération des documents par propriétaire",
        error
      );
      throw error;
    }
  }

  async getDocumentsByType(type: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction(
        "GetDocumentsByType",
        type
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la récupération des documents par type",
        error
      );
      throw error;
    }
  }

  async getDocumentsByValidator(validator: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction(
        "GetDocumentsByValidator",
        validator
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la récupération des documents par validateur",
        error
      );
      throw error;
    }
  }

  async getDocumentsByAccessor(accessor: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction(
        "GetDocumentsByAccessor",
        accessor
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la récupération des documents par accessor",
        error
      );
      throw error;
    }
  }

  // ===== GESTION DES ACCÈS =====

  async checkDocumentAccess(documentId: string, userId: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction(
        "CheckDocumentAccess",
        documentId,
        userId
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la vérification de l'accès au document",
        error
      );
      throw error;
    }
  }

  async addAccessor(documentId: string, newAccessor: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction(
        "AddAccessor",
        documentId,
        newAccessor
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de l'ajout de l'accessor", error);
      throw error;
    }
  }

  async removeAccessor(
    documentId: string,
    accessorToRemove: string
  ): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction(
        "RemoveAccessor",
        documentId,
        accessorToRemove
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors de la suppression de l'accessor", error);
      throw error;
    }
  }

  async changeValidator(
    documentId: string,
    newValidator: string
  ): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction(
        "ChangeValidator",
        documentId,
        newValidator
      );
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error("Erreur lors du changement de validateur", error);
      throw error;
    }
  }

  async getHistory(id: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction("GetHistory", id);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(
        "Erreur lors de la récupération de l'historique",
        error
      );
      throw error;
    }
  }
}
