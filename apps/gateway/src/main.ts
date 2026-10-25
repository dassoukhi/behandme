import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { ServiceLogger } from "@lib/platform";
import { AppModule } from "./app.module.js";
import { configureGateway, docsEnabled } from "./setup.js";
import { createOpenApiDocument } from "./swagger.js";

async function bootstrap() {
  const logger = new ServiceLogger("gateway");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
  });
  const configService = app.get(ConfigService);

  configureGateway(app);

  // Stop the background loops and close the database pool on SIGTERM (deploys).
  app.enableShutdownHooks();

  if (
    docsEnabled(
      configService.get<string>("NODE_ENV"),
      configService.get<string>("SWAGGER_ENABLED"),
    )
  ) {
    SwaggerModule.setup("api/docs", app, createOpenApiDocument(app));
  }

  // Get port from environment variables or use default
  const port = configService.get<number>("PORT", 3000);
  await app.listen(port);
  logger.log(`Gateway listening on ${await app.getUrl()}`, "Bootstrap");
}
bootstrap();
