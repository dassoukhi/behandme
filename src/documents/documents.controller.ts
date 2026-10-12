import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpException,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { FabricService } from "../fabric/fabric.service.js";
import {
  CreateDocumentDto,
  UpdateDocumentDto,
  TransferDocumentDto,
} from "./dto/document.dto.js";

@ApiTags("Documents")
@Controller("documents")
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name);

  constructor(private readonly fabricService: FabricService) {}

  @Post()
  @ApiOperation({ summary: "Créer un nouveau document" })
  @ApiBody({ type: CreateDocumentDto })
  @ApiResponse({ status: 201, description: "Document créé avec succès" })
  @ApiResponse({ status: 400, description: "Données invalides" })
  @ApiResponse({ status: 409, description: "Document déjà existant" })
  async createDocument(@Body() createDocumentDto: CreateDocumentDto) {
    try {
      const { id, title, type, content, owner, hash } = createDocumentDto;
      const result = await this.fabricService.createDocument(
        id,
        title,
        type,
        content,
        owner,
        hash,
      );

      this.logger.log(`Document créé: ${id}`);
      return {
        success: true,
        message: "Document créé avec succès",
        data: result,
      };
    } catch (error) {
      this.logger.error(`Erreur création document: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || "Erreur lors de la création du document",
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(":id")
  @ApiOperation({ summary: "Obtenir un document par ID" })
  @ApiParam({ name: "id", description: "ID du document" })
  @ApiResponse({ status: 200, description: "Document trouvé" })
  @ApiResponse({ status: 404, description: "Document non trouvé" })
  async getDocument(@Param("id") id: string) {
    try {
      const result = await this.fabricService.readDocument(id);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Erreur lecture document ${id}: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || "Document non trouvé",
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Put(":id")
  @ApiOperation({ summary: "Mettre à jour un document" })
  @ApiParam({ name: "id", description: "ID du document" })
  @ApiBody({ type: UpdateDocumentDto })
  @ApiResponse({ status: 200, description: "Document mis à jour avec succès" })
  @ApiResponse({ status: 404, description: "Document non trouvé" })
  async updateDocument(
    @Param("id") id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
  ) {
    try {
      const { title, type, content, status, hash } = updateDocumentDto;
      const result = await this.fabricService.updateDocument(
        id,
        title,
        type,
        content,
        status,
        hash,
      );

      this.logger.log(`Document mis à jour: ${id}`);
      return {
        success: true,
        message: "Document mis à jour avec succès",
        data: result,
      };
    } catch (error) {
      this.logger.error(`Erreur mise à jour document ${id}: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || "Erreur lors de la mise à jour du document",
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(":id")
  @ApiOperation({ summary: "Supprimer un document" })
  @ApiParam({ name: "id", description: "ID du document" })
  @ApiResponse({ status: 200, description: "Document supprimé avec succès" })
  @ApiResponse({ status: 404, description: "Document non trouvé" })
  async deleteDocument(@Param("id") id: string) {
    try {
      await this.fabricService.deleteDocument(id);

      this.logger.log(`Document supprimé: ${id}`);
      return {
        success: true,
        message: "Document supprimé avec succès",
      };
    } catch (error) {
      this.logger.error(`Erreur suppression document ${id}: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || "Erreur lors de la suppression du document",
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: "Obtenir tous les documents ou filtrer par critères",
  })
  @ApiQuery({
    name: "type",
    required: false,
    description: "Filtrer par type de document",
  })
  @ApiQuery({
    name: "owner",
    required: false,
    description: "Filtrer par propriétaire",
  })
  @ApiResponse({ status: 200, description: "Liste des documents" })
  async getAllDocuments(
    @Query("type") type?: string,
    @Query("owner") owner?: string,
  ) {
    try {
      let result;

      if (type) {
        result = await this.fabricService.getDocumentsByType(type);
      } else if (owner) {
        result = await this.fabricService.getDocumentsByOwner(owner);
      } else {
        result = await this.fabricService.getAllDocuments();
      }

      return {
        success: true,
        count: result.length,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Erreur récupération documents: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message:
            error.message || "Erreur lors de la récupération des documents",
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/transfer")
  @ApiOperation({ summary: "Transférer un document à un nouveau propriétaire" })
  @ApiParam({ name: "id", description: "ID du document" })
  @ApiBody({ type: TransferDocumentDto })
  @ApiResponse({ status: 200, description: "Document transféré avec succès" })
  @ApiResponse({
    status: 404,
    description: "Document ou nouveau propriétaire non trouvé",
  })
  async transferDocument(
    @Param("id") id: string,
    @Body() transferDto: TransferDocumentDto,
  ) {
    try {
      const { newOwner } = transferDto;
      const result = await this.fabricService.transferDocument(id, newOwner);

      this.logger.log(`Document transféré: ${id} vers ${newOwner}`);
      return {
        success: true,
        message: "Document transféré avec succès",
        data: result,
      };
    } catch (error) {
      this.logger.error(`Erreur transfert document ${id}: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || "Erreur lors du transfert du document",
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
