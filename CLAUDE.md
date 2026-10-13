# behandme — backend (NestJS)

NestJS 12 (ESM) API backed by Supabase, Clerk auth and Hyperledger Fabric. Its client is the
Expo app in a **separate repo**: `../behindMe` (GitHub `dassoukhi/behindMe`). This repo is `rachadia/behandme`.

## Working across front and back

- The two repos stay independent: separate git history, branches, commits and deploys.
  The only shared artifact is the API contract `openapi.json` (committed here).
- After any change to a route, DTO or response shape:
  1. `npm run openapi` — builds and writes `openapi.json` offline (no Supabase/Clerk/Fabric needed).
  2. In `../behindMe`: `npm run api:types && npm run typecheck` to see what the app must adapt.
  3. Commit `openapi.json` with the code change. Commit each repo separately.
- Keep Swagger metadata accurate — it _is_ the front's type source: `@ApiProperty` on every DTO field
  (with `type: () => X` for nested/array items), `@ApiResponse({ type })` on handlers, `PartialType`
  from `@nestjs/swagger` (not `@nestjs/mapped-types`).

## Commands

- `npm run start:dev` — watch mode, port `PORT` (default 3000). Swagger UI `/api/docs`, JSON `/api/docs-json`.
- `npm run build`, `npm run openapi`, `npm test` (vitest, specs in `src/**/*.spec.ts`),
  `npm run lint` (**applies fixes**), `npm run format`.
- Node 24 (`.nvmrc`). Env: see `.env.example` (Supabase + Clerk required to serve requests).

## Architecture

- All routes under `/api/v1` (`app.setGlobalPrefix`). Swagger config shared in `src/swagger.ts`.
- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`: **every** body field needs a
  class-validator decorator, otherwise requests fail with "property X should not exist".
- Auth: global `ClerkAuthGuard` (passport-custom strategy, `src/auth/`). Clients send
  `Authorization: Bearer <Clerk session JWT>`; opt out with `@Public()` (`src/decorators/`).
  `req.user` is the Clerk `User`; handlers currently take user ids from the path/body.
- Errors: `GlobalExceptionFilter` → `{ statusCode, timestamp, path, error, message }`.
- Feature modules in `src/<feature>/` (`*.controller.ts`, `*.service.ts`, `*.module.ts`, `dto/*.dto.ts`).
  Data: `SupabaseService` (`src/supabase/`, anon + service-role clients). Push: `src/expo/`.
  Fabric: `src/fabric/`, `src/documents/`, `src/user-chaincode/`.
- Updates use **PATCH** (users, contracts, notifications); Fabric routes use PUT.

## Conventions

- ESM: relative imports end in `.js` (`./app.module.js`); `import type` for type-only imports.
- Prettier defaults (double quotes, trailing commas), flat ESLint config, `any` allowed.
- Supabase columns are snake_case; notification DTOs are camelCase (known inconsistency).
