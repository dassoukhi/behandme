import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";
import { NotificationDto } from "./dto/notifications.dto.js";
import { CreateNotificationDto } from "./dto/create-notifications.dto.js";
import { UpdateNotificationDto } from "./dto/update-notifications.dto.js";
import { RegisterTokenDto } from "./dto/register-token.dto.js";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async registerToken(
    registerToken: RegisterTokenDto,
  ): Promise<RegisterTokenDto> {
    const { token, user_id } = registerToken;
    console.log(registerToken);

    let data;
    let error;

    if (user_id) {
      console.log("here in ", user_id);

      // Insert into the "push_tokens" table if user_id is defined
      ({ data, error } = await this.supabaseService
        .getClient()
        .from("push_tokens")
        .insert([{ token, user_id }])
        .select()
        .single());

      if (error) {
        this.logger.error(
          `Failed to register token in user_tokens: ${error.message}`,
        );
        throw error;
      }

      // After successful insertion, delete the token from "orphan_tokens" if it exists
      const { error: deleteError } = await this.supabaseService
        .getClient()
        .from("orphan_tokens")
        .delete()
        .match({ token });

      if (deleteError) {
        this.logger.warn(
          `Failed to delete token from orphan_tokens: ${deleteError.message}`,
        );
      }
    } else {
      // Insert into the "orphan_tokens" table if id_user is undefined
      ({ data, error } = await this.supabaseService
        .getClient()
        .from("orphan_tokens")
        .insert([{ token }])
        .select()
        .single());

      if (error) {
        this.logger.error(
          `Failed to register token in orphan_tokens: ${error.message}`,
        );
        throw error;
      }
    }

    return data;
  }

  async create(
    createNotificationDto: CreateNotificationDto,
  ): Promise<NotificationDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .insert([createNotificationDto])
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findAll(): Promise<NotificationDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .select("*");

    if (error) {
      this.logger.error(`Failed to fetch users: ${error.message}`);
      throw error;
    }
    console.log("data:", data);

    return data;
  }

  async findOne(id: string): Promise<NotificationDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      this.logger.error(`Failed to fetch user: ${error.message}`);
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return data;
  }

  async update(
    id: string,
    updateNotificationDto: UpdateNotificationDto,
  ): Promise<NotificationDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .update(updateNotificationDto)
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
      .from("notifications")
      .delete()
      .eq("id", id);

    if (error) {
      this.logger.error(`Failed to delete user: ${error.message}`);
      throw error;
    }

    return { message: `User with ID ${id} deleted successfully` };
  }
}
