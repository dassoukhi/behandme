import { Controller, Get, Post, Put, Delete, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { FabricService } from './fabric.service.js';
import { CreateAssetDto, UpdateAssetDto, TransferAssetDto } from './dto/index.js';

@ApiTags('Fabric Blockchain')
@Controller('fabric')
export class FabricController {
  private readonly contractName = 'basic';

  constructor(private readonly fabricService: FabricService) {}

  @Post('assets')
  @ApiOperation({ summary: 'Créer un nouvel asset sur la blockchain' })
  @ApiBody({ type: CreateAssetDto })
  @ApiResponse({ status: 201, description: 'Asset créé avec succès' })
  async createAsset(@Body() createAssetDto: CreateAssetDto) {
    try {
      const result = await this.fabricService.submitTransaction(
        this.contractName,
        'CreateAsset',
        createAssetDto.id,
        createAssetDto.color,
        createAssetDto.size.toString(),
        createAssetDto.owner,
        createAssetDto.appraisedValue.toString()
      );
      return { message: 'Asset créé avec succès', data: result };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('assets/:id')
  @ApiOperation({ summary: 'Récupérer un asset par son ID' })
  @ApiParam({ name: 'id', description: 'ID de l\'asset' })
  async getAsset(@Param('id') id: string) {
    try {
      const asset = await this.fabricService.evaluateTransaction(this.contractName, 'ReadAsset', id);
      return asset;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get('assets')
  @ApiOperation({ summary: 'Récupérer tous les assets' })
  async getAllAssets() {
    try {
      const assets = await this.fabricService.evaluateTransaction(this.contractName, 'GetAllAssets');
      return assets;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put('assets/:id')
  @ApiOperation({ summary: 'Mettre à jour un asset' })
  @ApiParam({ name: 'id', description: 'ID de l\'asset' })
  @ApiBody({ type: UpdateAssetDto })
  async updateAsset(@Param('id') id: string, @Body() updateAssetDto: UpdateAssetDto) {
    try {
      const result = await this.fabricService.submitTransaction(
        this.contractName,
        'UpdateAsset',
        id,
        updateAssetDto.color,
        updateAssetDto.size.toString(),
        updateAssetDto.owner,
        updateAssetDto.appraisedValue.toString()
      );
      return { message: 'Asset mis à jour avec succès', data: result };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete('assets/:id')
  @ApiOperation({ summary: 'Supprimer un asset' })
  @ApiParam({ name: 'id', description: 'ID de l\'asset' })
  async deleteAsset(@Param('id') id: string) {
    try {
      const result = await this.fabricService.submitTransaction(this.contractName, 'DeleteAsset', id);
      return { message: 'Asset supprimé avec succès', data: result };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('assets/:id/transfer')
  @ApiOperation({ summary: 'Transférer un asset à un nouveau propriétaire' })
  @ApiParam({ name: 'id', description: 'ID de l\'asset' })
  @ApiBody({ type: TransferAssetDto })
  async transferAsset(@Param('id') id: string, @Body() transferAssetDto: TransferAssetDto) {
    try {
      const result = await this.fabricService.submitTransaction(
        this.contractName,
        'TransferAsset',
        id,
        transferAssetDto.newOwner
      );
      return { message: 'Asset transféré avec succès', data: result };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('assets/:id/exists')
  @ApiOperation({ summary: 'Vérifier si un asset existe' })
  @ApiParam({ name: 'id', description: 'ID de l\'asset' })
  async assetExists(@Param('id') id: string) {
    try {
      const exists = await this.fabricService.evaluateTransaction(this.contractName, 'AssetExists', id);
      return { exists };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
