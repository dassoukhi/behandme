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

- `npm run dev` — the three services in watch mode: gateway (port 3000, Swagger UI `/api/docs`, JSON
  `/api/docs-json`), notifier (3001), worker (3002). One alone: `npm run start:dev` (gateway),
  `start:dev:notifier`, `start:dev:worker`. Env files: see "Configuration".
- `npm run verify` — **push gate**, see "Definition of done".
- `npm run build` (every app), `npm run openapi`, `npm test` (vitest, specs in `{apps,libs}/*/src/**/*.spec.ts`),
  `npm run lint` (**applies fixes**), `npm run format`.
- `npm run check:deps` — dependency rules (`.dependency-cruiser.cjs`), see "Monorepo layout".
- `npm run check:rls` — proves the anon key reads no table and calls no RPC (counts and status codes
  only). Run after every migration.
- `npm run check:schema` — replays the migrations on PGlite and compares them with the hosted schema
  captured in `supabase/introspection.json`. Run after the user applies a migration.
- Node 24 (`.nvmrc`; dependency-cruiser refuses Node 23). The repo `.npmrc` sets `legacy-peer-deps`, like the
  lockfile (pglite-socket lists every PGlite extension as a required peer).

## Monorepo layout

- `apps/<service>/src` — one deployable NestJS app per service, configured in `nest-cli.json` (tsc builder) with
  its own `tsconfig.app.json`: `gateway` (the public API, the only service the mobile app calls), `notifier`
  (notifications, push, internal API for the gateway), `handover` (contracts, their life cycle and audit
  log, internal API for the gateway), `worker` (scheduled jobs). Build
  output: `dist/apps/<service>/apps/<service>/src/main.js`.
- `libs/<name>/src` — shared code imported as `@lib/<name>` (aliases in the root `tsconfig.json` "paths",
  rewritten to relative paths at build by the Nest CLI, resolved by Vitest through `resolve.tsconfigPaths`):
  `kernel` (Clock, ids, Logger, errors, correlation), `contracts` (event types with zod schemas, internal API
  types), `messaging` (outbox, relay, consumer, pgmq, retention), `persistence` (Kysely + pg), `platform` (Nest
  building blocks: config, database module, health, internal-token guard, exception filter, logger, polling
  loops), `testing` (FakeClock, `startTestDatabase`). How messaging works: `docs/architecture.md`.
- Events: define them in `libs/contracts/src/events.ts` (new payload shape = new version), publish with
  `Event.create(payload)` through a transactional outbox, consume with `on(Event, handler)`, and route them with
  rows in `messaging.subscriptions` (a migration).
- New feature code follows clean architecture inside each module: `domain/` (pure rules, imports only
  domain code and `@lib/kernel`), `application/` (use cases and ports), `infrastructure/` (adapters:
  database, Clerk, push…), `interface/` (controllers, message consumers). The `*.module.ts` file wires them.
- `npm run check:deps` enforces: layers point inwards, no service imports another service, libs never import
  apps, no import cycle, no test code or devDependency in production code.

## Gateway architecture

- All routes under `/api/v1` (`app.setGlobalPrefix`), except `GET /health`. Swagger config shared in
  `apps/gateway/src/swagger.ts`.
- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`: **every** body field needs a
  class-validator decorator, otherwise requests fail with "property X should not exist".
- Auth: global `ClerkAuthGuard` (passport-custom strategy, `apps/gateway/src/auth/`). Clients send
  `Authorization: Bearer <Clerk session JWT>`; opt out with `@Public()` (`apps/gateway/src/decorators/`).
  `req.user` is `{ id }` (Clerk user id = `users.id`), read with `@CurrentUserId()`.
- Errors: `GlobalExceptionFilter` (`libs/platform`, every service) → `{ statusCode, timestamp, path, error, message }`. Domain and
  application code throw the `@lib/kernel` errors (`InvalidInputError` 400, `NotFoundError` 404,
  `ConflictError` 409, `UnprocessableError` 422), which the filter answers like the matching Nest
  exception. Any other error is a 500 whose message stays in the logs ("Internal server error" to the client).
- `users/` is layered (domain: visibility and trust rules; application: `ProfileService`, `TrustService`,
  their ports and a unit of work; infrastructure: Kysely repositories on `public.users`/`public.trusted` as
  `svc_gateway`, Clerk; interface: controller and DTOs) and is the model for new modules. Writes that other
  services must hear about go through `USERS_UNIT_OF_WORK`: the change and its event (`core.outbox`) commit
  together. Application specs run on in-memory ports (`users/testing/`), adapters on PGlite.
- `notifications/` relays the caller's requests to the notifier (`NotifierClient` port, `HttpNotifierClient`).
- `contracts/` relays to handover (`ContractsFacade`): it checks that the participants of a new contract are
  people the caller trusts, and adds the participants' profiles (visibility rule) to handover's records.
  `handover/` provides `HANDOVER_CLIENT` to the modules that need it. `keys/` stores users' public end-to-end
  keys (`core.user_keys`): it checks the Ed25519 signature of a registration with `node:crypto` and never
  handles a private key (protocol: the app's `docs/crypto-protocol.md`; shared fixture
  `apps/gateway/src/keys/testing/key-registration-v1.json`, a copy of the app's — keep them identical). A key
  reset needs a recent Clerk reverification (`fva` claim, `CurrentVerificationAge`) and puts the new keys in a
  72 h quarantine (`KEY_QUARANTINE_SECONDS_OVERRIDE` shortens it outside production only); see
  docs/architecture.md, "Key reset". `messaging/` runs the outbox relay and
  the gateway's queue. The gateway holds no Supabase key: each service uses its own Postgres role.
- Updates use **PATCH** (users, contracts, notifications).

## Access control (security-critical)

The database denies the public anon key (RLS on, no policies — `supabase/migrations/`), and each service
connects with its own role, limited to its schema: the gateway is the only gate for the app. Every handler
must:

- Take the caller's identity from `@CurrentUserId()`, **never** from the path, query or body. DTOs
  must not expose identity fields (`owner_id`, `user_id`, `id` of the caller…); the whitelist then
  rejects them. Caller-scoped routes live under `/users/me`.
- Filter in the query itself (`where owner_id = me`…) or pass the caller to the service that owns the data,
  and return **404** (not 403) for resources the caller cannot see.
- Rules: contracts readable by owner/accessor/validators; what each may do is handover's
  `allowedActions` (`apps/handover/src/contracts/domain/lifecycle.ts`: the owner edits a draft or an active
  contract, deletes a draft, seals a draft or re-seals an active one, revokes until release; the accessor or a
  validator claims, the owner cancels, the claimant withdraws, each validator decides once, the accessor opens
  a released contract); sealed material by role (`GET /contracts/:id/sealed`, with the owner's keys that
  signed it, and the accessor's current keys for a validator): the owner gets the envelope and their wrapped
  key, a validator their own share, the accessor only the signed manifest until release, then the release
  package (`GET /contracts/:id/release`) and nobody else; handover checks every
  sealing (`domain/sealing.ts`: signature, participants, registered keys, hashes, sizes, version) against
  the keys the gateway passes, never keys from the client; `status` and participants never client-writable, no secret material
  ever returned; participants must be distinct and trusted by the owner (trust checked by the gateway,
  distinctness by handover); a contract's audit log is append-only and readable by its participants; profiles expose
  email/phone only to yourself and to users who trust you (`apps/gateway/src/users/domain/profile.ts`);
  a profile's email comes from Clerk, never from the client; a trust link is removed by its owner only;
  a user's public keys are readable by them, the people they trust and the people who trust them, and replaced
  only by them after a Clerk reverification (`POST /users/me/keys/reset`), usable by others after a quarantine;
  notifications are recipient-only and created by services from events (no client create/send route).
- Internal services (notifier, handover) trust only the internal token: `@ForUser()` gives the user it names, and every
  query filters on it (another user's row → 404). Only the gateway signs tokens for a user.
- Tests: `apps/gateway/src/common/access-control.spec.ts` runs the real gateway services (profiles and trust on
  PGlite as `svc_gateway`, contracts through an in-memory handover, `apps/gateway/src/handover/testing/`) with a
  role × action matrix — extend it for every new route. Notifier and handover have their own
  (`apps/notifier/src/notifications/notifier.spec.ts`, `apps/handover/src/contracts/handover.spec.ts`, and
  each service's `internal-api.spec.ts`).

## Known gaps (decided, do not fix piecemeal)

- `DELETE /users/me` is refused (409) while the caller is the accessor or a validator of someone else's
  contract; their own drafts are deleted by handover (event `user.deleted`). Removing them from other people's
  contracts waits for the account-deletion saga (phase 6, `docs/architecture.md`), by the user's choice
  (2026-10-14).
- `public.contracts`, `public.notifications`, `public.push_tokens`, `public.orphan_tokens` and the RPCs
  `get_trusted_users` / `get_contract_with_validators` are no longer used; a later migration drops them
  (needs the user's confirmation).

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
| code in `apps/` or `libs/`   | `npm run dev` reloads by itself; redeploy any hosted instance            |
| route, DTO or response shape | `npm run openapi`, then in `../behindMe`: `npm run api:sync`             |
| `.env`, `.env.<service>`     | restart `npm run dev` (env is read at boot)                              |
| SQL migration                | the user applies it in the SQL editor, refreshes `supabase/introspection.json`, then `check:rls` and `check:schema` |

## Configuration

- Each service reads `.env.<service>` first (what differs: `DATABASE_URL` with its own role, `PORT`), then the
  shared `.env` (`INTERNAL_JWT_SECRET`, Supabase and Clerk keys, `NOTIFIER_URL`). Template: `.env.example`.
  Validated at boot (gateway: `apps/gateway/src/common/validators/env.validator.ts`; others: zod, `config.ts`).
- `MESSAGING_ENABLED=false` stops a service's background loops; `npm run openapi` sets it.
- Deployment (Docker image per service, Railway): `docs/deploy.md`.

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
- anon and authenticated have no right on anything (tables, functions, future objects in public), and new
  functions are not executable by PUBLIC: a migration that adds a function grants EXECUTE explicitly to the
  role that calls it (service_role or a `svc_*` role).
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
