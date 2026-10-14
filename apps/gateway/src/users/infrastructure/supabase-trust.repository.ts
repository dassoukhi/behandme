import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../../supabase/supabase.service.js";
import type { Profile } from "../domain/profile.js";
import type { TrustLink } from "../domain/trust.js";
import type { TrustRepository } from "../application/ports.js";

const UNIQUE_VIOLATION = "23505";

/** Trust links in public.trusted, through the service-role client. */
@Injectable()
export class SupabaseTrustRepository implements TrustRepository {
  private readonly logger = new Logger(SupabaseTrustRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  async add(ownerId: string, trustedId: string): Promise<TrustLink | null> {
    const { data, error } = await this.client
      .from("trusted")
      .insert([{ owner_id: ownerId, trusted_id: trustedId }])
      .select()
      .single<TrustLink>();
    if (error?.code === UNIQUE_VIOLATION) {
      return null;
    }
    return this.result(data, error, "add trusted user");
  }

  async trustedProfiles(ownerId: string): Promise<Profile[]> {
    const { data, error } = await this.client.rpc("get_trusted_users", {
      owner_uuid: ownerId,
    });
    return (this.result(data, error, "fetch trusted users") ?? []) as Profile[];
  }

  async trustedIds(ownerId: string, among?: string[]): Promise<string[]> {
    let query = this.client
      .from("trusted")
      .select("trusted_id")
      .eq("owner_id", ownerId);
    if (among) {
      query = query.in("trusted_id", among);
    }
    const { data, error } = await query;
    return (this.result(data, error, "fetch trust links") ?? []).map(
      (row) => row.trusted_id as string,
    );
  }

  async trusters(trustedId: string, ownerIds: string[]): Promise<string[]> {
    const { data, error } = await this.client
      .from("trusted")
      .select("owner_id")
      .eq("trusted_id", trustedId)
      .in("owner_id", ownerIds);
    return (this.result(data, error, "fetch trust links") ?? []).map(
      (row) => row.owner_id as string,
    );
  }

  private result<T>(
    data: T,
    error: { message: string } | null,
    action: string,
  ): T {
    if (error) {
      this.logger.error(`Failed to ${action}: ${error.message}`);
      throw error;
    }
    return data;
  }
}
