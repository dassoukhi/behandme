# behandme — BehindMe backend

NestJS 12 (ESM) API for the BehindMe mobile app (`../behindMe`). Authentication with Clerk, data in
Supabase Postgres (accessed with the service-role key; the public anon key is denied by RLS).

The backend is being reorganised into microservices (gateway, handover, notifier, worker); see the
project plan and `CLAUDE.md` for the target architecture and working rules.

## Requirements

- Node 24 (`.nvmrc`), npm
- A Supabase project and a Clerk application

## Setup

```bash
cp .env.example .env   # fill in Supabase and Clerk keys
npm install
npm run start:dev      # http://localhost:3000/api/v1, Swagger UI at /api/docs
```

## Commands

| Command | Purpose |
|---|---|
| `npm run verify` | Push gate: typecheck, lint, formatting, tests, OpenAPI contract up to date |
| `npm run openapi` | Build and write `openapi.json` (the contract consumed by the mobile app) |
| `npm test` | Vitest specs (`src/**/*.spec.ts`) |
| `npm run check:rls` | Prove the anon key reads no table and calls no RPC (run after every migration) |
| `npm run lint` | ESLint with auto-fix |
| `npm run format` | Prettier |

## Database changes

- Schema changes are versioned SQL files in `supabase/migrations/` (`YYYYMMDDHHMMSS_name.sql`), applied in the
  Supabase SQL editor, then checked with `npm run check:rls`.
- One-off data scripts live in `supabase/scripts/`; back up the affected rows before running them.
- `supabase/introspect.sql` is a read-only snapshot of the hosted schema.

## API

All routes are under `/api/v1` and require `Authorization: Bearer <Clerk session token>`, except the health
check. The identity of the caller always comes from the token, never from the request body. The full contract is
`openapi.json`; the access rules are described in `CLAUDE.md` ("Access control").
