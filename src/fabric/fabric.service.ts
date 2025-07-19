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
}
