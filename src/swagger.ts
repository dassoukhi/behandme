import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";

// Shared by main.ts (Swagger UI) and openapi.ts (contract file for the mobile app).
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("NestJS Supabase API")
    .setDescription("The NestJS Supabase API documentation")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
