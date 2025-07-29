import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gateway, Network, Contract, Wallet, Wallets } from 'fabric-network';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FabricService implements OnModuleInit {
  private readonly logger = new Logger(FabricService.name);
  private gateway: Gateway;
  private network: Network;
  private wallet: Wallet;
  private contract: Contract;
  private readonly contractName = 'user-transfer-basic';

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      await this.initializeFabricNetwork();
      this.logger.log('Fabric network initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Fabric network', error);
    }
  }

  private async initializeFabricNetwork() {
    const projectRoot = process.cwd();
    const ccpPath = path.resolve(projectRoot, 'fabric-network', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
    
    if (!fs.existsSync(ccpPath)) {
      throw new Error(`Connection profile not found at ${ccpPath}`);
    }

    const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
    this.wallet = await Wallets.newInMemoryWallet();

    const credPath = path.resolve(projectRoot, 'fabric-network', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'users', 'Admin@org1.example.com');
    const certPath = path.join(credPath, 'msp', 'signcerts', 'cert.pem');
    const keyPath = path.join(credPath, 'msp', 'keystore');

    if (!fs.existsSync(certPath)) {
      throw new Error(`Certificate not found at ${certPath}`);
    }

    const cert = fs.readFileSync(certPath).toString();
    const keyFiles = fs.readdirSync(keyPath);
    const keyFile = keyFiles[0];
    const key = fs.readFileSync(path.join(keyPath, keyFile)).toString();

    const identity = {
      credentials: {
        certificate: cert,
        privateKey: key,
      },
      mspId: 'Org1MSP',
      type: 'X.509',
    };

    await this.wallet.put('appUser', identity);

    this.gateway = new Gateway();
    await this.gateway.connect(ccp, {
      wallet: this.wallet,
      identity: 'appUser',
      discovery: { enabled: true, asLocalhost: true },
    });

    this.network = await this.gateway.getNetwork('mychannel');
  }

  private getContract(contractName: string): Contract {
    if (!this.network) {
      throw new Error('Fabric network not initialized. Please check the connection.');
    }
    return this.network.getContract(contractName);
  }

  async submitTransaction(contractName: string, functionName: string, ...args: string[]): Promise<string> {
    const contract = this.getContract(contractName);
    try {
      const result = await contract.submitTransaction(functionName, ...args);
      this.logger.log(`Transaction ${functionName} for contract ${contractName} submitted successfully`);
      return result.toString();
    } catch (error) {
      this.logger.error(`Failed to submit transaction ${functionName} for contract ${contractName}`, error);
      throw error;
    }
  }

  async evaluateTransaction(contractName: string, functionName: string, ...args: string[]): Promise<any> {
    const contract = this.getContract(contractName);
    try {
      const result = await contract.evaluateTransaction(functionName, ...args);
      this.logger.log(`Transaction ${functionName} for contract ${contractName} evaluated successfully`);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error(`Failed to evaluate transaction ${functionName} for contract ${contractName}`, error);
      throw error;
    }
  }

  async disconnect() {
    if (this.gateway) {
      await this.gateway.disconnect();
      this.logger.log('Fabric gateway disconnected');
    }
  }

  // ===== GESTION DES UTILISATEURS =====

  async createUser(id: string, firstName: string, lastName: string, email: string, phone: string, address: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction('CreateUser', id, firstName, lastName, email, phone, address);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la création de l\'utilisateur', error);
      throw error;
    }
  }

  async readUser(id: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('ReadUser', id);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la lecture de l\'utilisateur', error);
      throw error;
    }
  }

  async updateUser(id: string, firstName: string, lastName: string, email: string, phone: string, address: string, status: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction('UpdateUser', id, firstName, lastName, email, phone, address, status);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la mise à jour de l\'utilisateur', error);
      throw error;
    }
  }

  async deleteUser(id: string): Promise<void> {
    const contract = this.getContract(this.contractName);
    try {
      await contract.submitTransaction('DeleteUser', id);
    } catch (error) {
      this.logger.error('Erreur lors de la suppression de l\'utilisateur', error);
      throw error;
    }
  }

  async getAllUsers(): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetAllUsers');
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des utilisateurs', error);
      throw error;
    }
  }

  async getUsersByStatus(status: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetUsersByStatus', status);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des utilisateurs par statut', error);
      throw error;
    }
  }

  // ===== GESTION DES DOCUMENTS =====

  async createDocument(id: string, title: string, type: string, content: string, owner: string, validator: string, accessor: string[], hash: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const accessorJson = JSON.stringify(accessor);
      const result = await contract.submitTransaction('CreateDocument', id, title, type, content, owner, validator, accessorJson, hash);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la création du document', error);
      throw error;
    }
  }

  async readDocument(id: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('ReadDocument', id);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la lecture du document', error);
      throw error;
    }
  }

  async updateDocument(id: string, title: string, type: string, content: string, validator: string, accessor: string[], status: string, hash: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const accessorJson = JSON.stringify(accessor);
      const result = await contract.submitTransaction('UpdateDocument', id, title, type, content, validator, accessorJson, status, hash);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la mise à jour du document', error);
      throw error;
    }
  }

  async deleteDocument(id: string): Promise<void> {
    const contract = this.getContract(this.contractName);
    try {
      await contract.submitTransaction('DeleteDocument', id);
    } catch (error) {
      this.logger.error('Erreur lors de la suppression du document', error);
      throw error;
    }
  }

  async transferDocument(documentId: string, newOwner: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction('TransferDocument', documentId, newOwner);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors du transfert du document', error);
      throw error;
    }
  }

  async getAllDocuments(): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetAllDocuments');
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des documents', error);
      throw error;
    }
  }

  async getDocumentsByOwner(owner: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetDocumentsByOwner', owner);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des documents par propriétaire', error);
      throw error;
    }
  }

  async getDocumentsByType(type: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetDocumentsByType', type);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des documents par type', error);
      throw error;
    }
  }

  async getDocumentsByValidator(validator: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetDocumentsByValidator', validator);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des documents par validateur', error);
      throw error;
    }
  }

  async getDocumentsByAccessor(accessor: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetDocumentsByAccessor', accessor);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des documents par accessor', error);
      throw error;
    }
  }

  // ===== GESTION DES ACCÈS =====

  async checkDocumentAccess(documentId: string, userId: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('CheckDocumentAccess', documentId, userId);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la vérification de l\'accès au document', error);
      throw error;
    }
  }

  async addAccessor(documentId: string, newAccessor: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction('AddAccessor', documentId, newAccessor);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de l\'ajout de l\'accessor', error);
      throw error;
    }
  }

  async removeAccessor(documentId: string, accessorToRemove: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction('RemoveAccessor', documentId, accessorToRemove);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la suppression de l\'accessor', error);
      throw error;
    }
  }

  async changeValidator(documentId: string, newValidator: string): Promise<any> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.submitTransaction('ChangeValidator', documentId, newValidator);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors du changement de validateur', error);
      throw error;
    }
  }

  async getHistory(id: string): Promise<any[]> {
    const contract = this.getContract(this.contractName);
    try {
      const result = await contract.evaluateTransaction('GetHistory', id);
      return JSON.parse(result.toString());
    } catch (error) {
      this.logger.error('Erreur lors de la récupération de l\'historique', error);
      throw error;
    }
  }

}
