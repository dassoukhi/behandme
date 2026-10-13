import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UserProfileDto } from "./dto/user-profile.dto.js";
import { AddTrustedDto, TrustedLinkDto } from "./dto/add-trusted.dto.js";
import { projectProfile } from "./profile-visibility.js";

const SEARCH_LIMIT = 20;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async createMe(
    me: string,
    createUserDto: CreateUserDto,
  ): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .insert([{ ...createUserDto, id: me }])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictException("Profile already exists");
      }
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findMe(me: string): Promise<UserProfileDto> {
    const user = await this.findRow(me);
    if (!user) {
      throw new NotFoundException("Profile not found");
    }
    return user;
  }

  async findOne(me: string, id: string): Promise<UserProfileDto> {
    const user = await this.findRow(id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    const trustingMe = await this.whoTrusts(me, [id]);
    return projectProfile(user, me, trustingMe.has(id));
  }

  async updateMe(
    me: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .update(updateUserDto)
      .eq("id", me)
      .select()
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to update user: ${error.message}`);
      throw error;
    }
    if (!data) {
      throw new NotFoundException("Profile not found");
    }

    return data;
  }

  async removeMe(me: string): Promise<{ message: string }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .delete()
      .eq("id", me)
      .select("id");

    if (error) {
      this.logger.error(`Failed to delete user: ${error.message}`);
      throw error;
    }
    if (!data?.length) {
      throw new NotFoundException("Profile not found");
    }

    return { message: "Profile deleted successfully" };
  }

  async addTrusted(
    me: string,
    { trusted_id }: AddTrustedDto,
  ): Promise<TrustedLinkDto> {
    if (trusted_id === me) {
      throw new BadRequestException("You cannot trust yourself");
    }
    if (!(await this.findRow(trusted_id))) {
      throw new NotFoundException(`User with ID ${trusted_id} not found`);
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from("trusted")
      .insert([{ owner_id: me, trusted_id }])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictException("User is already trusted");
      }
      this.logger.error(`Failed to add trusted user: ${error.message}`);
      throw error;
    }

    return data;
  }

  async getMyTrusteds(me: string): Promise<UserProfileDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc("get_trusted_users", { owner_uuid: me });

    if (error) {
      this.logger.error(`Failed to fetch trusted users: ${error.message}`);
      throw error;
    }

    const users = (data ?? []) as UserProfileDto[];
    const trustingMe = await this.whoTrusts(
      me,
      users.map((u) => u.id),
    );
    return users.map((u) => projectProfile(u, me, trustingMe.has(u.id)));
  }

  /**
   * Partial match on first/last name, exact (case-insensitive) match on email so
   * addresses cannot be harvested from a fragment. Excludes the caller and the
   * users they already trust.
   */
  async searchUsers(me: string, query: string): Promise<UserProfileDto[]> {
    const term = query?.trim();
    if (!term) {
      throw new BadRequestException("Search query cannot be empty");
    }

    const client = this.supabaseService.getClient();
    const pattern = `%${escapeLike(term)}%`;

    // Separate queries instead of an `.or()` filter string: values passed to
    // ilike/eq are encoded by supabase-js, so user input cannot inject filters.
    const [byFirst, byLast, byEmail, trusted] = await Promise.all([
      client
        .from("users")
        .select("*")
        .ilike("first_name", pattern)
        .limit(SEARCH_LIMIT),
      client
        .from("users")
        .select("*")
        .ilike("last_name", pattern)
        .limit(SEARCH_LIMIT),
      client
        .from("users")
        .select("*")
        .ilike("email", escapeLike(term))
        .limit(SEARCH_LIMIT),
      client.from("trusted").select("trusted_id").eq("owner_id", me),
    ]);

    for (const result of [byFirst, byLast, byEmail, trusted]) {
      if (result.error) {
        this.logger.error(`Failed to search users: ${result.error.message}`);
        throw result.error;
      }
    }

    const excluded = new Set<string>([
      me,
      ...(trusted.data ?? []).map((t) => t.trusted_id as string),
    ]);
    const unique = new Map<string, UserProfileDto>();
    for (const user of [
      ...(byFirst.data ?? []),
      ...(byLast.data ?? []),
      ...(byEmail.data ?? []),
    ] as UserProfileDto[]) {
      if (!excluded.has(user.id)) {
        unique.set(user.id, user);
      }
    }

    const users = [...unique.values()]
      .sort((a, b) => (a.first_name ?? "").localeCompare(b.first_name ?? ""))
      .slice(0, SEARCH_LIMIT);
    const trustingMe = await this.whoTrusts(
      me,
      users.map((u) => u.id),
    );
    return users.map((u) => projectProfile(u, me, trustingMe.has(u.id)));
  }

  private async findRow(id: string): Promise<UserProfileDto | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("users")
      .select("*")
      .eq("id", id)
      .maybeSingle<UserProfileDto>();

    if (error) {
      this.logger.error(`Failed to fetch user: ${error.message}`);
      throw error;
    }
    return data;
  }

  /** IDs among `ids` of users who trust `me`. */
  async whoTrusts(me: string, ids: string[]): Promise<Set<string>> {
    const others = ids.filter((id) => id !== me);
    if (others.length === 0) {
      return new Set();
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from("trusted")
      .select("owner_id")
      .eq("trusted_id", me)
      .in("owner_id", others);

    if (error) {
      this.logger.error(`Failed to fetch trust links: ${error.message}`);
      throw error;
    }
    return new Set((data ?? []).map((row) => row.owner_id as string));
  }
}

/** Escapes LIKE wildcards so the search term is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
