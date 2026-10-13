/**
 * Writes the OpenAPI contract to openapi.json without starting the server.
 * Run with `npm run openapi` (builds first so the Swagger CLI plugin metadata is included).
 * Supabase/Clerk/Fabric are never contacted: placeholder env values are used when missing.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV ??= "development";
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder";

// Imported after the env defaults: ConfigModule validates env when app.module is evaluated.
const { NestFactory } = await import("@nestjs/core");
const { AppModule } = await import("./app.module.js");
const { createOpenApiDocument } = await import("./swagger.js");

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix("api/v1");
const document = createOpenApiDocument(app);

const outFile = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI contract written to ${outFile}`);

await app.close();
// FabricService may leave a gRPC client open; exit explicitly.
process.exit(0);
