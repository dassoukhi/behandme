import { Injectable } from '@nestjs/common';
import { FabricService } from '../fabric/fabric.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UserChaincodeService {
  private readonly contractName = 'user-transfer-basic';

  constructor(private readonly fabricService: FabricService) {}

  async createUser(createUserDto: CreateUserDto): Promise<string> {
    return this.fabricService.submitTransaction(
      this.contractName,
      'CreateUser',
      createUserDto.id
    );
  }

  async getAllUsers(): Promise<any> {
    return this.fabricService.evaluateTransaction(this.contractName, 'GetAllUsers');
  }

  async getUserById(id: string): Promise<any> {
    return this.fabricService.evaluateTransaction(this.contractName, 'ReadUser', id);
  }
}
