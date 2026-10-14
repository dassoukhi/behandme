import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { ServiceLogger } from "@lib/platform";
import { AppModule } from "./app.module.js";
import { configureApp } from "./setup.js";

/** Handover: contracts, their life cycle and audit log. Reached by the gateway only. */
async function bootstrap() {
  const logger = new ServiceLogger("handover");
  const app = await NestFactory.create(AppModule, { logger });
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(ConfigService).getOrThrow<number>("PORT");
  await app.listen(port);
  logger.log(`Handover listening on ${await app.getUrl()}`, "Bootstrap");
}
bootstrap();
