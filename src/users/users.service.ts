import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UserProfileDto } from "./dto/user-profile.dto.js";
import { AddTrustedDto } from "./dto/add-trusted.dto.js";

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async create(createUserDto: CreateUserDto): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .insert([createUserDto])
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findAll(): Promise<UserProfileDto[]> {
    const test = await this.supabaseService.getClient();

    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .select("*");

    if (error) {
      this.logger.error(`Failed to fetch users: ${error.message}`);
      throw error;
    }
    return data;
  }

  async findOne(id: string): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .select("*")
      .eq("id", id)
      .single<UserProfileDto>();

    if (error) {
      this.logger.error(`Failed to fetch user: ${error.message}`);
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return data;
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto
  ): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .update(updateUserDto)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update user: ${error.message}`);
      throw error;
    }

    if (!data) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return data;
  }

  async remove(id: string): Promise<{ message: string }> {
    const { error } = await this.supabaseService
      .getClient()
      .from("users")
      .delete()
      .eq("id", id);

    if (error) {
      this.logger.error(`Failed to delete user: ${error.message}`);
      throw error;
    }

    return { message: `User with ID ${id} deleted successfully` };
  }

  async addTrusted(addTrustedDto: AddTrustedDto): Promise<AddTrustedDto> {
    const owner = await this.findOne(addTrustedDto.owner_id);
    const trusted = await this.findOne(addTrustedDto.trusted_id);

    const { data, error } = await this.supabaseService
      .getClient()
      .from("trusted")
      .insert([addTrustedDto])
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to add trusted user: ${error.message}`);
      throw error;
    }

    return data;
  }

  async getTrusteds(owner_id: string): Promise<UserProfileDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc("get_trusted_users", {
        owner_uuid: owner_id,
      });

    if (error) {
      this.logger.error(`Failed to fetch trusted users: ${error.message}`);
      throw error;
    }

    return data;
  }

  async searchUsers(
    query: string,
    excludeId?: string
  ): Promise<UserProfileDto[]> {
    try {
      if (!query || query.trim().length === 0) {
        throw new BadRequestException("Search query cannot be empty");
      }

      const searchTerm = query.trim().toLowerCase();
      console.log("query:", searchTerm);

      // Construction de la requête
      let queryBuilder = this.supabaseService
        .getAdminClient()
        .from("users")
        .select("*");

      // Recherche sur plusieurs champs
      queryBuilder = queryBuilder.or(
        `first_name.ilike.%${searchTerm}%,` +
          `last_name.ilike.%${searchTerm}%,` +
          `email.ilike.%${searchTerm}%`
      );

      // Exclure l'utilisateur actuel
      if (excludeId) {
        queryBuilder = queryBuilder.neq("id", excludeId);
      }

      // Vérifier qu'ils ne sont pas déjà trusteds
      if (excludeId) {
        const { data: existingTrusteds } = await this.supabaseService
          .getAdminClient()
          .from("trusteds")
          .select("trusted_id")
          .eq("owner_id", excludeId);

        if (existingTrusteds && existingTrusteds.length > 0) {
          const trustedIds = existingTrusteds.map((t) => t.trusted_id);
          queryBuilder = queryBuilder.not(
            "id",
            "in",
            `(${trustedIds.join(",")})`
          );
        }
      }

      // Ordonner par pertinence (nom commence par la recherche en premier)
      queryBuilder = queryBuilder
        .order("first_name", { ascending: true })
        .limit(20);

      const { data, error } = await queryBuilder;

      if (error) {
        throw new Error(`Error searching users: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new Error(`Failed to search users: ${error.message}`);
    }
  }
}
