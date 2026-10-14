import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { correlationMiddleware } from "@lib/platform";

/** HTTP setup shared by main.ts and the API tests. */
export function configureApp(app: INestApplication): void {
  // The gateway's correlation id, so handover's logs join the request's.
  app.use(correlationMiddleware);
  app.setGlobalPrefix("internal/v1", { exclude: ["health"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
