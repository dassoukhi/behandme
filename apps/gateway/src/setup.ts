import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { correlationMiddleware } from "@lib/platform";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor.js";

/** HTTP setup shared by main.ts and the API tests. */
export function configureGateway(app: NestExpressApplication): void {
  // Behind Caddy (deploy/vm/Caddyfile): the client's address is the first X-Forwarded-For hop, which
  // the rate limit counts by, in memory, for requests without a user. Nothing logs it.
  app.set("trust proxy", 1);
  // Every request (and what it logs or publishes) carries a correlation id.
  app.use(correlationMiddleware);
  // Every route under /api/v1, except the host's health check.
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.enableCors();
}

/**
 * The interactive API docs (/api/docs): in development, and in production only with
 * SWAGGER_ENABLED=true (they list every route to anyone).
 */
export function docsEnabled(
  nodeEnv: string | undefined,
  swaggerEnabled: string | undefined,
): boolean {
  return nodeEnv !== "production" || swaggerEnabled === "true";
}
