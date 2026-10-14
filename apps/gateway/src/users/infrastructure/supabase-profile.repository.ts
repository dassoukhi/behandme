import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../../supabase/supabase.service.js";
import type { Profile } from "../domain/profile.js";
import type { ProfileFields, ProfileRepository } from "../application/ports.js";

/** Profiles in public.users, through the service-role client. */
@Injectable()
export class SupabaseProfileRepository implements ProfileRepository {
  private readonly logger = new Logger(SupabaseProfileRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get users() {
    return this.supabaseService.getClient().from("users");
  }

  async find(id: string): Promise<Profile | null> {
    const { data, error } = await this.users
      .select("*")
      .eq("id", id)
      .maybeSingle<Profile>();
    return this.result(data, error, "fetch user");
  }

  async create(id: string, fields: ProfileFields): Promise<Profile> {
    const { data, error } = await this.users
      .insert([{ id, ...fields }])
      .select()
      .single<Profile>();
    // single() fails rather than return nothing.
    return this.result(data, error, "create profile") as Profile;
  }

  async update(id: string, fields: ProfileFields): Promise<Profile | null> {
    const { data, error } = await this.users
      .update(fields)
      .eq("id", id)
      .select()
      .maybeSingle<Profile>();
    return this.result(data, error, "update profile");
  }

  async delete(id: string): Promise<boolean> {
    const { data, error } = await this.users.delete().eq("id", id).select("id");
    return (this.result(data, error, "delete profile")?.length ?? 0) > 0;
  }

  async search(term: string, limit: number): Promise<Profile[]> {
    const pattern = `%${escapeLike(term)}%`;
    // Separate queries instead of an `.or()` filter string: values passed to ilike are encoded by
    // supabase-js, so user input cannot inject filters.
    const results = await Promise.all([
      this.users.select("*").ilike("first_name", pattern).limit(limit),
      this.users.select("*").ilike("last_name", pattern).limit(limit),
      this.users.select("*").ilike("email", escapeLike(term)).limit(limit),
    ]);
    return results.flatMap(
      ({ data, error }) =>
        (this.result(data, error, "search users") ?? []) as Profile[],
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

/** Escapes LIKE wildcards so the search term is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
