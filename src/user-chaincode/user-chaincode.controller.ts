import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpStatus,
  HttpException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CreateChaincodeUserDto } from "./dto/create-user.dto.js";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { FabricService } from "../fabric/fabric.service.js";
import { CurrentUserId } from "../auth/current-user.decorator.js";

// Each user can only manage and read their own ledger identity.
@ApiTags("User Chaincode")
@ApiBearerAuth()
@Controller("user-chaincode")
export class UserChaincodeController {
  private readonly logger = new Logger(UserChaincodeController.name);

  constructor(private readonly fabricService: FabricService) {}

  private assertSelf(id: string, me: string) {
    if (id !== me) {
      throw new NotFoundException("Utilisateur non trouvé");
    }
  }

  @Post()
  @ApiOperation({ summary: "Créer un nouvel utilisateur" })
  @ApiResponse({ status: 201, description: "Utilisateur créé avec succès" })
  @ApiResponse({ status: 400, description: "Données invalides" })
  @ApiResponse({ status: 409, description: "Utilisateur déjà existant" })
  async createUser(@CurrentUserId() me: string) {
    const id = me;
    try {
      const result = await this.fabricService.createUser(id);

      this.logger.log(`Utilisateur créé: ${id}`);
      return {
        success: true,
        message: "Utilisateur créé avec succès",
        data: result,
      };
    } catch (error) {
      this.logger.error(`Erreur création utilisateur: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message:
            error.message || "Erreur lors de la création de l'utilisateur",
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(":id")
  @ApiOperation({ summary: "Obtenir un utilisateur par ID" })
  @ApiParam({ name: "id", description: "ID de l'utilisateur" })
  @ApiResponse({ status: 200, description: "Utilisateur trouvé" })
  @ApiResponse({ status: 404, description: "Utilisateur non trouvé" })
  async getUser(@CurrentUserId() me: string, @Param("id") id: string) {
    this.assertSelf(id, me);
    try {
      const result = await this.fabricService.readUser(id);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Erreur lecture utilisateur ${id}: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || "Utilisateur non trouvé",
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Put(":id")
  @ApiOperation({ summary: "Mettre à jour un utilisateur" })
  @ApiParam({ name: "id", description: "ID de l'utilisateur" })
  @ApiBody({ type: CreateChaincodeUserDto })
  @ApiResponse({
    status: 200,
    description: "Utilisateur mis à jour avec succès",
  })
  @ApiResponse({ status: 404, description: "Utilisateur non trouvé" })
  async updateUser(
    @CurrentUserId() me: string,
    @Param("id") id: string,
    @Body() updateUserDto: CreateChaincodeUserDto,
  ) {
    this.assertSelf(id, me);
    try {
      const { status } = updateUserDto;
      const result = await this.fabricService.updateUser(id, status);

      this.logger.log(`Utilisateur mis à jour: ${id}`);
      return {
        success: true,
        message: "Utilisateur mis à jour avec succès",
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Erreur mise à jour utilisateur ${id}: ${error.message}`,
      );
      throw new HttpException(
        {
          success: false,
          message:
            error.message || "Erreur lors de la mise à jour de l'utilisateur",
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(":id")
  @ApiOperation({ summary: "Supprimer un utilisateur" })
  @ApiParam({ name: "id", description: "ID de l'utilisateur" })
  @ApiResponse({ status: 200, description: "Utilisateur supprimé avec succès" })
  @ApiResponse({ status: 404, description: "Utilisateur non trouvé" })
  @ApiResponse({
    status: 409,
    description: "Impossible de supprimer: utilisateur possède des documents",
  })
  async deleteUser(@CurrentUserId() me: string, @Param("id") id: string) {
    this.assertSelf(id, me);
    try {
      await this.fabricService.deleteUser(id);

      this.logger.log(`Utilisateur supprimé: ${id}`);
      return {
        success: true,
        message: "Utilisateur supprimé avec succès",
      };
    } catch (error) {
      this.logger.error(
        `Erreur suppression utilisateur ${id}: ${error.message}`,
      );

      const status = error.message.includes("possède encore")
        ? HttpStatus.CONFLICT
        : HttpStatus.NOT_FOUND;

      throw new HttpException(
        {
          success: false,
          message:
            error.message || "Erreur lors de la suppression de l'utilisateur",
        },
        status,
      );
    }
  }

  @Get(":id/documents")
  @ApiOperation({ summary: "Obtenir tous les documents d'un utilisateur" })
  @ApiParam({ name: "id", description: "ID de l'utilisateur" })
  @ApiResponse({
    status: 200,
    description: "Liste des documents de l'utilisateur",
  })
  async getUserDocuments(@CurrentUserId() me: string, @Param("id") id: string) {
    this.assertSelf(id, me);
    try {
      const result = await this.fabricService.getDocumentsByOwner(id);

      return {
        success: true,
        count: result.length,
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Erreur récupération documents utilisateur ${id}: ${error.message}`,
      );
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

  @Get(":id/accessible-documents")
  @ApiOperation({
    summary: "Obtenir tous les documents accessibles par un utilisateur",
  })
  @ApiParam({ name: "id", description: "ID de l'utilisateur" })
  @ApiResponse({ status: 200, description: "Liste des documents accessibles" })
  async getAccessibleDocuments(
    @CurrentUserId() me: string,
    @Param("id") id: string,
  ) {
    this.assertSelf(id, me);
    try {
      const result = await this.fabricService.getDocumentsByAccessor(id);

      return {
        success: true,
        count: result.length,
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Erreur récupération documents accessibles ${id}: ${error.message}`,
      );
      throw new HttpException(
        {
          success: false,
          message:
            error.message ||
            "Erreur lors de la récupération des documents accessibles",
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id/validation-documents")
  @ApiOperation({
    summary: "Obtenir tous les documents à valider par un utilisateur",
  })
  @ApiParam({ name: "id", description: "ID de l'utilisateur validateur" })
  @ApiResponse({ status: 200, description: "Liste des documents à valider" })
  async getValidationDocuments(
    @CurrentUserId() me: string,
    @Param("id") id: string,
  ) {
    this.assertSelf(id, me);
    try {
      const result = await this.fabricService.getDocumentsByValidator(id);

      return {
        success: true,
        count: result.length,
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Erreur récupération documents validation ${id}: ${error.message}`,
      );
      throw new HttpException(
        {
          success: false,
          message:
            error.message ||
            "Erreur lors de la récupération des documents à valider",
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id/history")
  @ApiOperation({ summary: "Obtenir l'historique d'un utilisateur" })
  @ApiParam({ name: "id", description: "ID de l'utilisateur" })
  @ApiResponse({ status: 200, description: "Historique de l'utilisateur" })
  async getUserHistory(@CurrentUserId() me: string, @Param("id") id: string) {
    this.assertSelf(id, me);
    try {
      const result = await this.fabricService.getHistory(id);

      return {
        success: true,
        count: result.length,
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Erreur récupération historique utilisateur ${id}: ${error.message}`,
      );
      throw new HttpException(
        {
          success: false,
          message:
            error.message || "Erreur lors de la récupération de l'historique",
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
