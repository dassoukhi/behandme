import { type INestApplication, ValidationPipe } from "@nestjs/common";

/** HTTP setup shared by main.ts and the API tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix("internal/v1", { exclude: ["health"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
