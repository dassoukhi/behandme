/**
 * Writes the OpenAPI contract of the public API without starting the server.
 * Run with `npm run openapi` (builds first so the Swagger CLI plugin metadata is included),
 * which writes `openapi.json` at the repository root (the file the mobile app reads).
 * Supabase, Clerk, the database and the notifier are never contacted: placeholder env values are
 * used when missing, and the app is never initialised (no background loop starts).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.NODE_ENV ??= "development";
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder";
process.env.CLERK_SECRET_KEY ??= "placeholder";
process.env.DATABASE_URL ??= "postgresql://placeholder@localhost/placeholder";
process.env.NOTIFIER_URL ??= "http://localhost:3001";
process.env.INTERNAL_JWT_SECRET ??=
  "placeholder-placeholder-placeholder-placeholder";
process.env.MESSAGING_ENABLED = "false";

// Imported after the env defaults: ConfigModule validates env when app.module is evaluated.
const { NestFactory } = await import("@nestjs/core");
const { AppModule } = await import("./app.module.js");
const { createOpenApiDocument } = await import("./swagger.js");

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix("api/v1", { exclude: ["health"] });
const document = createOpenApiDocument(app);

const outFile = resolve(process.argv[2] ?? "openapi.json");
writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI contract written to ${outFile}`);

await app.close();
// Exit explicitly in case a provider keeps a handle open.
process.exit(0);
