import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private supabaseClient: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    // Service-role client only: Row Level Security denies the public anon key,
    // so this API is the single entry point and must enforce access itself
    // (see CurrentUserId and the per-service ownership filters).
    this.supabaseClient = createClient(
      this.configService.getOrThrow<string>("SUPABASE_URL"),
      this.configService.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    this.logger.log("Supabase client initialized");
  }

  getClient(): SupabaseClient {
    return this.supabaseClient;
  }
}
