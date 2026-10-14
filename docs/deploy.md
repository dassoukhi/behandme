# Running and deploying the services

Four services, one image each (same `Dockerfile`, `SERVICE` build argument):

| Service    | Port (default) | Reached by                         | Database role  |
| ---------- | -------------- | ---------------------------------- | -------------- |
| `gateway`  | 3000           | the mobile app (public)            | `svc_gateway`  |
| `notifier` | 3001           | the gateway (private network only) | `svc_notifier` |
| `worker`   | 3002           | nobody (health check only)         | `svc_worker`   |
| `handover` | 3003           | the gateway (private network only) | `svc_handover` |

All four serve `GET /health` (200 when the database answers). Logs are JSON lines in production, with the
service name and the correlation id of the request or event.

## Database, once

1. Apply the migrations not yet applied, in order, in the Supabase SQL editor (`supabase/migrations/`). Then run
   `supabase/introspect.sql`, save its output as `supabase/introspection.json`, and run `npm run check:rls` and
   `npm run check:schema`.
2. Give each service role a password (from a password manager, never in git):

   ```sql
   alter role svc_gateway with login password '…';
   alter role svc_notifier with login password '…';
   alter role svc_worker with login password '…';
   alter role svc_handover with login password '…';
   ```

3. Each service's `DATABASE_URL` uses the Supabase pooler in transaction mode (port 6543) with that role:
   `postgresql://svc_notifier.<project-ref>:<password>@<pooler host>:6543/postgres` (the pooler host is in
   Supabase > Connect).

## Local development

```bash
cp .env.example .env        # shared values and the gateway's
# .env.gateway, .env.notifier, .env.handover, .env.worker: DATABASE_URL of each role (+ PORT, except the gateway)
npm run dev                 # the four services in watch mode
```

`MESSAGING_ENABLED=false` stops a service's background loops (outbox relay, queue consumer, push sending).

## Railway

1. New project → four services from the GitHub repo `rachadia/behandme`, each with its config file
   (Settings → Config-as-code): `railway/gateway.json`, `railway/notifier.json`, `railway/handover.json`,
   `railway/worker.json` (Dockerfile build, health check on `/health`, restart on failure).
2. Variables:

   | Variable              | gateway                                            | notifier           | handover           | worker           |
   | --------------------- | -------------------------------------------------- | ------------------ | ------------------ | ---------------- |
   | `SERVICE`             | `gateway`                                          | `notifier`         | `handover`         | `worker`         |
   | `NODE_ENV`            | `production`                                       | same               | same               | same             |
   | `PORT`                | (set by Railway)                                   | `3001`             | `3003`             | `3002`           |
   | `DATABASE_URL`        | `svc_gateway` URL                                  | `svc_notifier` URL | `svc_handover` URL | `svc_worker` URL |
   | `INTERNAL_JWT_SECRET` | one shared value                                   | same               | same               | same             |
   | `CLERK_SECRET_KEY`    | yes                                                |                    |                    |                  |
   | `NOTIFIER_URL`        | `http://${{notifier.RAILWAY_PRIVATE_DOMAIN}}:3001` |                    |                    |                  |
   | `HANDOVER_URL`        | `http://${{handover.RAILWAY_PRIVATE_DOMAIN}}:3003` |                    |                    |                  |
   | `EXPO_ACCESS_TOKEN`   |                                                    | optional           |                    |                  |

   The services never get the Supabase service-role key: each reaches the database with its own role.

3. Networking: generate a public domain for the gateway only. The notifier and handover are reached on the
   private network; the worker needs no domain.
4. The app: `EXPO_PUBLIC_API_URL=https://<gateway domain>/api/v1`.

Several instances of a service can run side by side: outbox rows and pending pushes are locked with
`SKIP LOCKED`, queue messages are hidden while handled, and the worker's scheduled jobs are recorded once per
period (`ops.job_runs`).

## Push notifications

The notifier sends through Expo's push service, which needs the app's credentials in EAS: the FCM V1 key for
Android and the APNs key for iOS (`eas credentials`). Without them, sends fail and are retried with a growing
delay, then marked failed; the in-app notification is unaffected.
