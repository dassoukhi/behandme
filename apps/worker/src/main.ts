import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { ServiceLogger } from "@lib/platform";
import { AppModule } from "./app.module.js";

/** Worker: scheduled and background jobs. Serves only GET /health. */
async function bootstrap() {
  const logger = new ServiceLogger("worker");
  const app = await NestFactory.create(AppModule, { logger });
  app.enableShutdownHooks();
  const port = app.get(ConfigService).getOrThrow<number>("PORT");
  await app.listen(port);
  logger.log(
    `Worker running, health on ${await app.getUrl()}/health`,
    "Bootstrap",
  );
}
bootstrap();
