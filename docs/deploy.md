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

## One server (OVHcloud VPS): the current target

Everything on one Ubuntu machine, from `deploy/vm/`: the four services and Caddy, which serves the gateway
on `https://api.behyndme.com` with a Let's Encrypt certificate it renews by itself. Only Caddy (80, 443) and
SSH listen on the internet; the services reach each other on Docker's internal network, by name. The server
keeps no data (the database is Supabase's): another one is rebuilt with these steps and the variables.

1. **Order**: ovhcloud.com → VPS → **VPS-1** (2 vCores, 4 GB; about €4.49 excl. VAT a month without
   commitment in November 2026), a datacenter **in France** (the privacy policy says the server is there), an
   **Ubuntu** LTS image (24.04 or 26.04: the first server, in November 2026, runs 26.04) and your SSH public key.
   Note the VPS's IPv4 address. Out of stock?
   `node scripts/ovh-vps-stock.mjs` shows where each model can be ordered now (OVHcloud's public order API;
   `--all` for every datacenter), and `--watch` asks every minute and notifies when one comes back in France;
   `node --env-file=.env.notifier scripts/ovh-vps-stock.mjs --watch --email <address>` e-mails too, through the
   notifier's Resend key (`--test-email` sends one at once).
2. **DNS**: OVHcloud → Domain names → `behyndme.com` → DNS zone: the `A` record `api` → the VPS's IPv4.
   Delete any `AAAA` record `api`: Let's Encrypt would try it first. `dig +short api.behyndme.com` shows
   the change.
3. **On the server** (`ssh ubuntu@<ip>`): ordered without an SSH key, the VPS has a password (a link in
   OVHcloud's delivery e-mail) that expires at the first login: log in once in a terminal to change it, then
   `ssh-copy-id -i ~/.ssh/<key>.pub ubuntu@<ip>`. SSH must take keys only.
   `sudo sshd -T | grep -i '^passwordauthentication'` prints `no`; otherwise,
   `echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/00-keys-only.conf` and
   `sudo systemctl reload ssh` (the first value read wins, hence `00-`). Then a read-only deploy key for the
   private repo, the clone and the one-time setup (Docker, firewall, security updates, swap):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/behandme -N "" && cat ~/.ssh/behandme.pub
   # GitHub → dassoukhi/behandme → Settings → Deploy keys → Add (read only), paste the key
   printf 'Host github.com\n  IdentityFile ~/.ssh/behandme\n' >> ~/.ssh/config
   git clone -b develop git@github.com:dassoukhi/behandme.git ~/behandme
   bash ~/behandme/deploy/vm/setup-server.sh   # then log out and back in
   ```

   The server follows `develop` until launch, then `main`.
4. **Variables**: copy `deploy/vm/env-example/compose.env` to `deploy/vm/.env`, the other files of
   `env-example/` to `deploy/vm/env/`, fill them in (the `svc_*` URLs of "Database, once" above), then
   `chmod 600 deploy/vm/.env deploy/vm/env/*`. They are ignored by git.
5. **Start**: `~/behandme/deploy/vm/update.sh` builds the images (several minutes the first time) and starts
   everything; Caddy gets the certificate once the DNS record points to the server. Check
   `curl https://api.behyndme.com/health`.
6. **The app**: `EXPO_PUBLIC_API_URL=https://api.behyndme.com/api/v1`.

Day to day, from `~/behandme/deploy/vm`: `./update.sh` deploys what was pushed (pull, build, restart what
changed); `docker compose logs -f gateway` shows a service's logs (5 × 10 MB kept per service);
`docker compose ps` their health. Containers restart on failure and with the machine; security updates
install every day, and a kernel update needs a reboot now and then (`sudo reboot`).

Closing an account at someone's request (heirs, lost access; see `docs/architecture.md`, "Closing an account on
request"): `docker compose exec gateway node dist/apps/gateway/apps/gateway/src/close-account.js <user id or e-mail>`
says what it would do; add `--confirm` to close it.

## Oracle Cloud Always Free (alternative)

Free, but its Ampere instances are often out of capacity in Paris, and the privacy policy would have to name
Oracle instead of OVHcloud. The steps above, except the order:

- **Account**: cloud.oracle.com/free, home region **France Central (Paris)**: Always Free resources exist only
  in the home region, and it cannot be changed later.
- **Instance**: Ubuntu 24.04 (the aarch64 image), shape **`VM.Standard.A1.Flex`** (Ampere, Arm) with
  **1 OCPU and 3 GB** (Always Free: 2 OCPUs and 12 GB in all), a public IPv4 address, your SSH public key.
  Only A1.Flex (and the tiny E2.1.Micro) is free: an AMD `E3/E4/E5.Flex` of the same size costs about $21 a
  month once the trial credits are spent. Keep it small: Oracle reclaims an Always Free instance as idle when
  CPU, network **and** memory all stay under 20 % for 7 days, and the services use about 1 GB. On "Out of
  capacity", try again later.
- **Network**: in the subnet's security list, add ingress rules for TCP 80 and 443 from `0.0.0.0/0`. Oracle's
  Ubuntu images also reject those ports in iptables; `setup-server.sh` opens them.

## Railway (alternative)

1. New project → four services from the GitHub repo `dassoukhi/behandme`, each with its config file
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
   | `RESEND_API_KEY`      |                                                    | for e-mail         |                    |                  |
   | `EMAIL_FROM`          |                                                    | optional           |                    |                  |
   | `SWAGGER_ENABLED`     | optional: `true` serves `/api/docs` in production  |                    |                    |                  |

   The services never get the Supabase service-role key: each reaches the database with its own role.

3. Networking: generate a public domain for the gateway only. The notifier and handover are reached on the
   private network; the worker needs no domain.
4. The app: `EXPO_PUBLIC_API_URL=https://<gateway domain>/api/v1`.

The gateway counts requests per signed-in user (else per client address, read from the proxy's
`X-Forwarded-For`): 120 a minute, 30 on each route that looks up an invitation or a contact code, then 429 with a `Retry-After` header. Counts are
kept per instance, in memory. `/health` is never limited, and `/api/docs` is off in production unless
`SWAGGER_ENABLED=true`.

Every push to `main` or `develop` runs `npm run verify` on GitHub Actions (`.github/workflows/verify.yml`).

Several instances of a service can run side by side: outbox rows and pending pushes are locked with
`SKIP LOCKED`, queue messages are hidden while handled, and the worker's scheduled jobs are recorded once per
period (`ops.job_runs`).

## E-mail

The notifier sends e-mails through Resend once `RESEND_API_KEY` is set; without it, e-mail is off and the
notifier says so at start-up. To turn it on:

1. At Resend, add the domain `behyndme.com` in the EU region (`eu-west-1`).
2. At OVH, add the DNS records Resend shows: DKIM (`resend._domainkey`), and SPF and MX on the `send`
   subdomain for bounces; add `_dmarc` with `v=DMARC1; p=none;` to start. They do not touch Vercel's A record.
3. Create an API key with sending access only, limited to `behyndme.com`, and set it as `RESEND_API_KEY` on the
   notifier. `EMAIL_FROM` defaults to `BehyndMe <alertes@behyndme.com>`.

Resend's free plan sends 3,000 e-mails a month and 100 a day. Past the day's quota, e-mails wait for the next
midnight UTC (logged as a warning); one not sent within 3 days is dropped. Move to a paid plan before the daily
volume nears 100.

## Push notifications

The notifier sends through Expo's push service, which needs the app's credentials in EAS: the FCM V1 key for
Android and the APNs key for iOS (`eas credentials`). Without them, sends fail and are retried with a growing
delay, then marked failed; the in-app notification is unaffected.
