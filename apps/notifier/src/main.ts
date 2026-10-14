import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { ServiceLogger } from "@lib/platform";
import { AppModule } from "./app.module.js";
import { configureApp } from "./setup.js";

/** Notifier: notifications, push tokens and preferences. Reached by the gateway only. */
async function bootstrap() {
  const logger = new ServiceLogger("notifier");
  const app = await NestFactory.create(AppModule, { logger });
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(ConfigService).getOrThrow<number>("PORT");
  await app.listen(port);
  logger.log(`Notifier listening on ${await app.getUrl()}`, "Bootstrap");
}
bootstrap();
