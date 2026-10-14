import { plainToInstance } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  validateSync,
} from "class-validator";
import { MIN_SECRET_LENGTH } from "@lib/platform";

enum Environment {
  Development = "development",
  Production = "production",
  Test = "test",
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  PORT: number;

  @IsString()
  SUPABASE_URL: string;

  // No longer used by the API (service-role only); kept optional for tooling.
  @IsOptional()
  @IsString()
  SUPABASE_ANON_KEY?: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Verifies session tokens and reads verified identities (profile emails).
  @IsString()
  CLERK_SECRET_KEY: string;

  // Postgres as svc_gateway (Supabase pooler): profiles, trust links, core.outbox, the gateway queue.
  @IsString()
  DATABASE_URL: string;

  // Internal URL of the notifier service.
  @IsUrl({ require_tld: false, require_protocol: true })
  NOTIFIER_URL: string;

  // Signs the gateway's calls to the other services (shared with them).
  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  INTERNAL_JWT_SECRET: string;

  // "false" stops the outbox relay and the queue consumer (tooling, tests).
  @IsOptional()
  @IsIn(["true", "false"])
  MESSAGING_ENABLED?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(
    EnvironmentVariables,
    {
      ...config,
      PORT: config.PORT ? parseInt(config.PORT as string, 10) : 3000,
    },
    { enableImplicitConversion: true },
  );

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
