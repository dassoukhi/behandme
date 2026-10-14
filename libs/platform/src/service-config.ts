import { z } from "zod";
import { MIN_SECRET_LENGTH } from "./internal-token.js";

/** Variables every internal service (notifier, worker) reads. */
export const serviceEnv = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  /** Postgres URL with the service's own role (svc_<service>), through the Supabase pooler. */
  DATABASE_URL: z.string().min(1),
  INTERNAL_JWT_SECRET: z.string().min(MIN_SECRET_LENGTH),
  /** "false" stops the background loops (tooling, tests). */
  MESSAGING_ENABLED: z.enum(["true", "false"]).optional(),
});

/**
 * ConfigModule options of a service: its own file first (.env.<service>, for what differs between
 * services such as DATABASE_URL), then the shared .env. On the host, variables come from the
 * environment and the files are absent.
 */
export function serviceConfig<S extends z.ZodObject>(
  service: string,
  schema: S,
) {
  return {
    isGlobal: true,
    envFilePath: [`.env.${service}`, ".env"],
    validate: (env: Record<string, unknown>) => {
      const parsed = schema.safeParse(env);
      if (!parsed.success) {
        throw new Error(
          `Invalid environment for ${service}: ${z.prettifyError(parsed.error)}`,
        );
      }
      return parsed.data;
    },
  };
}
