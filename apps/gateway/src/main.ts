import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { correlationMiddleware, ServiceLogger } from "@lib/platform";
import { AppModule } from "./app.module.js";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor.js";
import { createOpenApiDocument } from "./swagger.js";

async function bootstrap() {
  const logger = new ServiceLogger("gateway");
  const app = await NestFactory.create(AppModule, { logger });
  const configService = app.get(ConfigService);

  // Every request (and what it logs or publishes) carries a correlation id.
  app.use(correlationMiddleware);

  // Every route under /api/v1, except the host's health check.
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });

  // Enable validation pipe globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Apply logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Enable CORS
  app.enableCors();

  // Stop the background loops and close the database pool on SIGTERM (deploys).
  app.enableShutdownHooks();

  // Setup Swagger documentation
  const document = createOpenApiDocument(app);
  SwaggerModule.setup("api/docs", app, document);

  // Get port from environment variables or use default
  const port = configService.get<number>("PORT", 3000);
  await app.listen(port);
  logger.log(`Gateway listening on ${await app.getUrl()}`, "Bootstrap");
}
bootstrap();
