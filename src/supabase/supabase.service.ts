import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private supabaseClient: SupabaseClient;
  private supabaseAdminClient: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.getOrThrow<string>("SUPABASE_URL");
    const supabaseAnonKey =
      this.configService.getOrThrow<string>("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = this.configService.getOrThrow<string>(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

    this.supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    this.supabaseAdminClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    );

    this.logger.log("Supabase client initialized");
  }

  getClient(): SupabaseClient {
    return this.supabaseClient;
  }

  getAdminClient(): SupabaseClient {
    return this.supabaseAdminClient;
  }
}
