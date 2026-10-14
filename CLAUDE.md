# behandme — backend (NestJS)

NestJS 12 (ESM) monorepo backed by Supabase Postgres and Clerk auth. Its client is the Expo app in a
**separate repo**: `../behindMe` (GitHub `dassoukhi/behindMe`). This repo is `rachadia/behandme`.
The target architecture (microservices, messaging, contract life cycle, end-to-end encryption) and the
delivery order are in `docs/architecture.md`.

## Working across front and back

- The two repos stay independent: separate git history, branches, commits and deploys.
  The only shared artifact is the API contract `openapi.json` (committed here).
- After any change to a route, DTO or response shape:
  1. `npm run openapi` — builds the gateway and writes `openapi.json` offline (no Supabase/Clerk needed).
  2. In `../behindMe`: `npm run api:types && npm run typecheck` to see what the app must adapt.
  3. Commit `openapi.json` with the code change. Commit each repo separately.
- Keep Swagger metadata accurate — it _is_ the front's type source: `@ApiProperty` on every DTO field
  (with `type: () => X` for nested/array items), `@ApiResponse({ type })` on handlers, `PartialType`
  from `@nestjs/swagger` (not `@nestjs/mapped-types`).

## Commands

- `npm run start:dev` — gateway in watch mode, port `PORT` (default 3000). Swagger UI `/api/docs`, JSON `/api/docs-json`.
- `npm run verify` — **push gate**, see "Definition of done".
- `npm run build` (every app), `npm run openapi`, `npm test` (vitest, specs in `{apps,libs}/*/src/**/*.spec.ts`),
  `npm run lint` (**applies fixes**), `npm run format`.
- `npm run check:deps` — dependency rules (`.dependency-cruiser.cjs`), see "Monorepo layout".
- `npm run check:rls` — proves the anon key reads no table and calls no RPC (counts and status codes
  only). Run after every migration.
- `npm run check:schema` — replays the migrations on PGlite and compares them with the hosted schema
  captured in `supabase/introspection.json`. Run after the user applies a migration.
- Node 24 (`.nvmrc`). Env: see `.env.example` (Supabase + Clerk required to serve requests).

## Monorepo layout

- `apps/<service>/src` — one deployable NestJS app per service, configured in `nest-cli.json` (tsc builder) with
  its own `tsconfig.app.json`. Today: `gateway` (the public API, the only service the mobile app calls).
  Planned: `handover`, `notifier`, `worker`. Build output: `dist/apps/<service>/apps/<service>/src/main.js`.
- `libs/<name>/src` — shared code imported as `@lib/<name>` (aliases in the root `tsconfig.json` "paths",
  rewritten to relative paths at build by the Nest CLI, resolved by Vitest through `resolve.tsconfigPaths`):
  `kernel` (Clock, ids, Logger), `messaging` (outbox, relay, consumer, pgmq), `persistence` (Kysely + pg),
  `testing` (FakeClock, `startTestDatabase`). How messaging works: `docs/architecture.md`.
- New feature code follows clean architecture inside each module: `domain/` (pure rules, imports only
  domain code and `@lib/kernel`), `application/` (use cases and ports), `infrastructure/` (adapters:
  database, Clerk, push…), `interface/` (controllers, message consumers). The `*.module.ts` file wires them.
- `npm run check:deps` enforces: layers point inwards, no service imports another service, libs never import
  apps, no import cycle, no test code or devDependency in production code.

## Gateway architecture

- All routes under `/api/v1` (`app.setGlobalPrefix`). Swagger config shared in `apps/gateway/src/swagger.ts`.
- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`: **every** body field needs a
  class-validator decorator, otherwise requests fail with "property X should not exist".
- Auth: global `ClerkAuthGuard` (passport-custom strategy, `apps/gateway/src/auth/`). Clients send
  `Authorization: Bearer <Clerk session JWT>`; opt out with `@Public()` (`apps/gateway/src/decorators/`).
  `req.user` is `{ id }` (Clerk user id = `users.id`), read with `@CurrentUserId()`.
- Errors: `GlobalExceptionFilter` → `{ statusCode, timestamp, path, error, message }`.
- Existing feature modules (`apps/gateway/src/<feature>/`: `*.controller.ts`, `*.service.ts`, `*.module.ts`,
  `dto/*.dto.ts`) predate the layers and are moved into them feature by feature.
  Data: `SupabaseService` (`apps/gateway/src/supabase/`, service-role client only). Push: `apps/gateway/src/expo/`.
- Updates use **PATCH** (users, contracts, notifications).

## Access control (security-critical)

The database denies the public anon key (RLS on, no policies — `supabase/migrations/`), so this API
is the only gate and connects with the service-role key, which bypasses RLS. Every handler must:

- Take the caller's identity from `@CurrentUserId()`, **never** from the path, query or body. DTOs
  must not expose identity fields (`owner_id`, `user_id`, `id` of the caller…); the whitelist then
  rejects them. Caller-scoped routes live under `/users/me`.
- Filter in the Supabase query itself (`.eq("owner_id", me)`, `participantFilter(me)`), and return
  **404** (not 403) for resources the caller cannot see.
- Rules: contracts readable by owner/accessor/validators, name/description writable by the owner only,
  `status` and participants never client-writable, no secret material ever returned
  (`apps/gateway/src/contracts/`); participants must be distinct and trusted by the owner; profiles expose
  email/phone only to yourself and to users who trust you (`apps/gateway/src/users/profile-visibility.ts`);
  a profile's email comes from Clerk, never from the client; notifications are recipient-only and created
  server-side (no client create/send route).
- Tests: `apps/gateway/src/common/access-control.spec.ts` runs the real services against an in-memory Supabase
  (`apps/gateway/src/testing/in-memory-supabase.ts`) with a role × action matrix — extend it for every new route.

## Definition of done

`npm run verify` must print `VERIFY PASSED`: typecheck, dependency rules, ESLint without auto-fix,
Prettier check, vitest, build of every app, and `openapi.json` regenerated with no uncommitted diff.
Push only then (global rule in `~/.claude/CLAUDE.md`). New or changed routes also extend the role × action
matrix in `apps/gateway/src/common/access-control.spec.ts`, and a fixed bug ships a test shown to fail
without the fix.
If the contract changed, push this repo before the front.

## What to restart

| Change                       | Action                                                                   |
| ---------------------------- | ------------------------------------------------------------------------ |
| code in `apps/` or `libs/`   | `npm run start:dev` reloads by itself; redeploy any hosted instance      |
| route, DTO or response shape | `npm run openapi`, then in `../behindMe`: `npm run api:sync`             |
| `.env`                       | restart `start:dev` (env is read at boot)                                |
| SQL migration                | the user applies it in the SQL editor, refreshes `supabase/introspection.json`, then `check:rls` and `check:schema` |

## Data changes (Supabase)

- Schema, RLS and grants: a new file in `supabase/migrations/` (`YYYYMMDDHHMMSS_name.sql`), wrapped in
  `begin; … commit;`. Deploy the API first if it depends on the change.
- Test a migration before handing it over: `startTestDatabase()` (`@lib/testing`) replays every migration on
  PGlite with the Supabase roles and pgmq 1.4.4 (the hosted version), and specs check the rights of each role
  with `asRole` (example: `libs/messaging/src/migration.spec.ts`). `20261001000000_baseline_schema.sql` is the
  schema from before migrations were tracked: never run it on the hosted project.
- After the user applies a migration: they run `supabase/introspect.sql` in the SQL editor and save the JSON
  as `supabase/introspection.json`; then `npm run check:rls` and `npm run check:schema` (the replayed
  migrations must give exactly the hosted schema; `check:schema` is not in `verify`, since a migration is
  pushed before it is applied).
- Service roles (`svc_gateway`, `svc_handover`, `svc_notifier`, `svc_worker`) are created without LOGIN; the
  user sets their passwords in the SQL editor. Passwords and connection strings never go in git.
- Row fixes or test-data changes: a versioned SQL script too, never ad-hoc. Save the rows it will touch
  (service-role read into the scratchpad) before it runs, and verify the result after.
- `npx supabase db query --linked` hangs on this network (TLS-inspecting proxy): hand the SQL to the
  user for the dashboard SQL editor. Do not read CLI tokens from the keychain.
- The database is shared; confirm before any write.

## Conventions

- ESM: relative imports end in `.js` (`./app.module.js`); libraries are imported as `@lib/<name>`;
  `import type` for type-only imports.
- Prettier defaults (double quotes, trailing commas), flat ESLint config, `any` allowed.
- Supabase columns are snake_case; notification DTOs are camelCase (known inconsistency).
