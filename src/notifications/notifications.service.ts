import { randomUUID } from "node:crypto";
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

  /** Token registered before sign-in; linked later by registerPushToken. */
  async registerOrphanToken({
    token,
  }: RegisterTokenDto): Promise<RegisterTokenDto> {
    const client = this.supabaseService.getClient();

    // Already known (orphan or linked): nothing to do.
    const [orphan, linked] = await Promise.all([
      client.from("orphan_tokens").select("id").eq("token", token).limit(1),
      client.from("push_tokens").select("id").eq("token", token).limit(1),
    ]);
    if (orphan.error) throw orphan.error;
    if (linked.error) throw linked.error;
    if (orphan.data.length || linked.data.length) {
      return { token };
    }

    const { error } = await client
      .from("orphan_tokens")
      .insert([{ id: randomUUID(), token }]);
    if (error) {
      this.logger.error(`Failed to register orphan token: ${error.message}`);
      throw error;
    }
    return { token };
  }

  /** Links a device token to the caller, taking it over from any previous owner. */
  async registerPushToken(
    me: string,
    { token }: RegisterTokenDto,
  ): Promise<RegisterTokenDto> {
    const client = this.supabaseService.getClient();

    // A device belongs to whoever is signed in on it now.
    const { error: unlinkError } = await client
      .from("push_tokens")
      .delete()
      .eq("token", token);
    if (unlinkError) throw unlinkError;

    const { error } = await client
      .from("push_tokens")
      .insert([{ id: randomUUID(), token, user_id: me }]);
    if (error) {
      this.logger.error(`Failed to register push token: ${error.message}`);
      throw error;
    }

    const { error: orphanError } = await client
      .from("orphan_tokens")
      .delete()
      .eq("token", token);
    if (orphanError) {
      this.logger.warn(
        `Failed to delete token from orphan_tokens: ${orphanError.message}`,
      );
    }

    return { token };
  }

  /** Server-side only: notifications are never created by clients. */
  async create(
    createNotificationDto: CreateNotificationDto,
  ): Promise<NotificationDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .insert([{ id: randomUUID(), data: {}, ...createNotificationDto }])
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findAll(me: string): Promise<NotificationDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .select("*")
      .eq("userId", me)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch notifications: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findOne(me: string, id: string): Promise<NotificationDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .select("*")
      .eq("id", id)
      .eq("userId", me)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to fetch notification: ${error.message}`);
      throw error;
    }
    if (!data) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    return data;
  }

  async update(
    me: string,
    id: string,
    updateNotificationDto: UpdateNotificationDto,
  ): Promise<NotificationDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .update(updateNotificationDto)
      .eq("id", id)
      .eq("userId", me)
      .select()
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to update notification: ${error.message}`);
      throw error;
    }
    if (!data) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    return data;
  }

  async remove(me: string, id: string): Promise<{ message: string }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("notifications")
      .delete()
      .eq("id", id)
      .eq("userId", me)
      .select("id");

    if (error) {
      this.logger.error(`Failed to delete notification: ${error.message}`);
      throw error;
    }
    if (!data?.length) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    return { message: `Notification with ID ${id} deleted successfully` };
  }
}
