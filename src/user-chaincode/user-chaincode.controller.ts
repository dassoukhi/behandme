import { Controller, Get, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { UserChaincodeService } from './user-chaincode.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@ApiTags('User Chaincode')
@Controller('user-chaincode')
export class UserChaincodeController {
  constructor(private readonly userChaincodeService: UserChaincodeService) {}

  @Post()
  @ApiOperation({ summary: 'Créer un nouvel utilisateur sur la blockchain' })
  @ApiResponse({ status: 201, description: 'Utilisateur créé avec succès.' })
  async createUser(@Body() createUserDto: CreateUserDto) {
    try {
      const result = await this.userChaincodeService.createUser(createUserDto);
      return { message: 'Utilisateur créé avec succès', data: JSON.parse(result) };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Récupérer tous les utilisateurs de la blockchain' })
  @ApiResponse({ status: 200, description: 'Utilisateurs récupérés avec succès.' })
  async getAllUsers() {
    try {
      return await this.userChaincodeService.getAllUsers();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un utilisateur par son ID depuis la blockchain' })
  @ApiParam({ name: 'id', description: 'ID de l\'utilisateur' })
  @ApiResponse({ status: 200, description: 'Utilisateur récupéré avec succès.' })
  @ApiResponse({ status: 404, description: 'Utilisateur non trouvé.' })
  async getUser(@Param('id') id: string) {
    try {
      return await this.userChaincodeService.getUserById(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }
}
