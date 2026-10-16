# BehindMe backend architecture

BehindMe lets an **owner** hand a secret (social network, device or cloud access) to an **accessor**. The
secret is released only after a claim, a contest window and a quorum of trusted **validators**. The server
never sees the secret: it is encrypted end to end on the owner's phone.

This document is the target design. The four services exist; end-to-end encryption, claims and release come
with phases 4 and 5 (see "Delivery order"). Running and deploying them: `docs/deploy.md`.

## Services

One NestJS app per service in `apps/`, each deployed separately. The mobile app talks to the gateway only.

| Service    | Responsibility                                                                                                                                       | Owns (Postgres schema)                                                          | Exposes                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `gateway`  | Clerk authentication, access control, response composition, public OpenAPI (`openapi.json`). Identity domain: profiles, trust links, public E2E keys | `core`: users, trusted, user_keys (+ history)                                   | Public REST API `/api/v1/*`                                     |
| `handover` | Whole contract life cycle: draft, sealing (encrypted vault), claims, votes, deadlines, release, revocation; hash-chained audit log                   | `handover`: contracts, envelopes, key_wraps, claims, decisions, contract_events | Internal API (commands and queries from the gateway) and events |
| `notifier` | In-app notifications, Expo push (and Resend email, phase 5), preferences, push tokens, deliveries and their receipts                                 | `notify`: notifications, push_tokens, preferences, deliveries                   | Internal API (inbox, devices, settings) and event consumers     |
| `worker`   | Schedules recurring jobs (push receipts, claims catch-up, audit-log verification, retention)                                                         | `ops`: job_runs                                                                 | Nothing public; driven by pg_cron ticks and its queue           |

A service reads and writes **its own schema only**. Data owned by another service is obtained through that
service's API or kept as a local copy fed by its events.

## Communication

**Synchronous (internal HTTP)** only when the gateway needs an immediate answer for the app (read the inbox,
file a claim and return it, read a contract). Calls go to `/internal/v1/*` on the private network with a
signed internal JWT (`libs/platform`: HS256, shared `INTERNAL_JWT_SECRET`, audience = the called service,
60 s, subject = the user the request is for), which the called service's global guard checks. They have a 5 s
timeout and one retry when the call is idempotent; a command that is not idempotent by nature (deleting a
notification is not retried; claims, phase 5) carries an **idempotency key**. Request and response types are
shared through `libs/contracts` (e.g. `notifier-api.ts`); the gateway keeps its own DTO classes for OpenAPI.

**Asynchronous (events)** for everything else:

- **Transactional outbox.** A service writes its state change and the event into `<schema>.outbox` in the
  same transaction: no lost event, no phantom event.
- **Relay** (`OutboxRelay`). Reads the outbox with `FOR UPDATE SKIP LOCKED`, sends each event to the
  pgmq queue of every subscriber (routing in `messaging.subscriptions`, one queue per consuming service),
  then marks the row as sent, in one transaction: each event is enqueued exactly once.
- **Consumers** (`QueueConsumer`). Read their queue with a visibility timeout and handle each message
  **idempotently**: the handler's writes and a row in the service's `processed_messages` commit together,
  and the message is deleted after commit (a redelivery finds the row and does nothing). A message that is
  malformed, has no handler, or failed N times is archived (dead letter) and logged as an error.
- **Rights.** A service reads only its own queue; it sends to any queue through `messaging.send`
  (`security definer`), so it never needs rights on another service's queue tables.
- **Delayed messages.** An outbox row with `deliver_at` is sent with the matching pgmq delay, for deadlines
  (end of the contest window, reminders).
- **Batch.** Every minute the `pg_cron` job `worker-tick` calls `ops.send_tick()`, which puts a
  `scheduler.tick` event in the worker's queue. On each tick the worker publishes the event of every job whose
  period has no run yet (`ops.job_runs`, one row per job and period), e.g. `maintenance.push_receipts_due`
  every 15 minutes, `maintenance.retention_due` daily; the service that owns the data does the work. Duplicate
  or missed ticks, and several worker instances, still fire each job once per period.
- **Envelope.** `{ id, type, version, occurredAt, correlationId, causationId, payload }`. Event types and their
  payload schemas (zod) are versioned in `libs/contracts` (`events.ts`), checked when publishing
  (`TrustAdded.create`) and when consuming (`on(TrustAdded, handler)`); a payload that does not match is
  dead-lettered at once. Today: `trust.added`, `keys.rotated`, `user.deleted`, `claim.filed`,
  `claim.quorum_reached`, `claim.reminder`, `claim.closed`, `contract.released`, `claim.reminder_due` and
  `claim.deadline_due` (handover to itself, delayed), `contract.revoked`, `participant.left`, `scheduler.tick`, `maintenance.push_receipts_due`, `maintenance.claims_due`,
  `maintenance.retention_due`. Later: `contract.sealed`.
- **Correlation.** The gateway gives each request a correlation id (`x-correlation-id`, kept from the caller
  when valid); it travels in internal calls and in every event's envelope, consumers run with it, and every
  log line carries it (`ServiceLogger`, JSON in production).
- **`MessageBus` port.** Implemented by `PgmqBus`. A broker such as RabbitMQ or NATS can replace pgmq later
  without touching domain code (consumers already acknowledge after commit, which any transport supports).
  Tests run the real pgmq SQL on PGlite rather than an in-memory imitation.

## Inside a service: clean architecture

```
apps/<service>/src/<module>/
  domain/          entities, value objects, pure rules (state machine, threshold, health). No dependency.
  application/     use cases (commands, queries) and the ports they need (repositories, bus, clock, clients)
  infrastructure/  adapters: Kysely repositories, PgmqBus, Expo push, Resend, Clerk, internal HTTP clients
  interface/       HTTP controllers, message consumers, jobs
  <module>.module.ts   wires the layers (the only file allowed to see all of them)
libs/
  kernel/          Clock, ids, Logger port, business errors, correlation context
  contracts/       versioned event types and payload schemas, internal API types
  messaging/       envelope, MessageBus port + PgmqBus, transactional outbox, relay, idempotent consumer, retention
  persistence/     createDatabase: Kysely over a pg pool (Supabase pooler)
  platform/        Nest building blocks of every service: config, database module, health, internal-token
                   guard, exception filter, logger, correlation middleware, polling loops (MessagingRuntime)
  testing/         FakeClock, startTestDatabase: PGlite + Supabase roles + pgmq 1.4.4 (the hosted version)
                   + a pg_cron stub + the migrations
```

`npm run check:deps` (dependency-cruiser) enforces the direction of dependencies: domain ← application ←
infrastructure / interface, no service importing another, libs never importing apps.

**Data access.** Direct Postgres connection through the Supabase pooler with Kysely (typed queries, real
transactions). One Postgres role per service, limited to its schema. RLS stays enabled everywhere and the
public anon key has no access. One exception until the data moves to `core`: the gateway's users module
writes `public.users` and `public.trusted` as `svc_gateway` (granted by migration 20261014180000). No service
holds the Supabase service-role key.

**Notifications.** A service publishes a business event; the notifier turns it into notifications (French
copy in `apps/notifier/.../domain/templates.ts`) in the event's transaction: inbox rows, plus one row per
device in `notify.deliveries` for users who should be pushed (critical ones always are). A loop sends the due
deliveries through Expo after commit, so a rolled-back event never pushes; a failed send is retried with a
growing delay, then marked failed. Receipts are checked 15 minutes later; `DeviceNotRegistered` forgets the
device. Lock-screen text never holds a secret or a contract description.

## Contract life cycle (handover, pure domain)

Contract: `draft | active | claimed | released | revoked`.
Claim: `open | cancelled | withdrawn | rejected | expired | released`.

| Transition         | Who                                                                    | Condition                                                              |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| create → draft     | owner                                                                  | participants trusted, distinct, with E2E keys (checked by the gateway) |
| seal / reseal      | owner                                                                  | no open claim; expected version (compare-and-set)                      |
| active → claimed   | accessor or validator                                                  | one open claim at a time; 72 h cooldown                                |
| approve / reject   | validator, once                                                        | approving _is_ re-wrapping their key share for the accessor            |
| claimed → active   | owner ("I'm here"), claimant, rejections > n − k, expiry after 60 days | release ciphertexts deleted                                            |
| claimed → released | system                                                                 | approvals ≥ k **and** contest window elapsed (7 days by default, 3–30) |
| any → revoked      | owner                                                                  | before release; all ciphertexts deleted                                |

k = ⌊n/2⌋ + 1 for n validators. The gateway returns `my_role` and `allowed_actions` (then `open_claim`,
`threshold` and `health`) so the app implements no rule itself. Today: create (draft), update (owner; draft
or active), delete (owner; draft only, its log stays), seal (owner; draft, or active to re-seal), revoke
(owner; active or claimed, which also closes the claim), claim (accessor or validator; active, not within 72 h
of the owner cancelling their last claim), cancel_claim (owner), withdraw_claim (the claimant), decide
(each validator once), open (accessor; released), in `apps/handover/src/contracts/domain/lifecycle.ts` and
`domain/claims.ts`. `health` (gateway) counts the validators whose current keys are still those of the
sealing: a share wrapped to reset keys is lost until the owner re-seals. Sealing stores the
envelope, the owner's wrapped key, one wrapped share per validator and the signed manifest
(`handover.envelopes`, `handover.key_wraps`); handover checks them against the registered keys the gateway
passes along (`domain/sealing.ts`; the envelope must be padded, format 2: 1 KiB, or a power of two up to 32 KiB,
so that its size does not give the secret's length) and keeps only the current sealing. Revocation and cancellation are always decided by
handover, the single authority on the life cycle, which removes "revoke vs release" races.

**Claims and release** (`apps/handover/src/contracts/application/claims.service.ts`). A claim moves the
contract to `claimed` and publishes `claim.filed` (the owner's alert is critical) and `claim.deadline_due`,
delayed to the end of the contest window (`contest_days`, 7 by default; `CLAIM_CONTEST_SECONDS_OVERRIDE`
shortens it outside production). An approval stores the validator's share re-wrapped to the accessor's current
keys, which must be out of quarantine (the server checks its size and the key version, not its content).
Rejections beyond n − k close the claim; k approvals publish `claim.quorum_reached`, and the release happens
once both quorum and deadline are there (on the delayed message, on the approval that completes the quorum
after the deadline, or at the worker's hourly `maintenance.claims_due`). A day before the end of the window (halfway
through a window under two days), `claim.reminder` gives the owner a critical last reminder and asks the
validators who have not decided again. An open claim without quorum expires
after 60 days. Closing without release erases the re-wrapped shares; after a release only the accessor gets
the package (`GET /contracts/:id/release`: envelope, signed manifest, k re-wrapped shares). Times come from the
service clock.

**Key reset.** A user who lost their recovery phrase (or fears their keys leaked) registers new keys with the
next `key_version` (`POST /users/me/keys/reset`, gateway `keys/`). A stolen session must not be enough: the
request needs a Clerk reverification less than 10 minutes old (the session token's `fva` claim, Clerk's
"strict" level; otherwise 403 with Clerk's `clerk_error` hint, which the app's `useReverification` handles).
The old keys go to `core.user_key_history`; the new ones are usable by others only after a 72-hour quarantine
(`usable_from`; handover refuses a sealing with keys in quarantine, the owner's included), and `keys.rotated`
alerts the user (critical push) and the people who trust them (compare the new security code). Contracts sealed
with the old keys stay as they are: the owner can no longer read them and re-seals them with the secret.

**Account deletion.** `DELETE /users/me` needs a recent Clerk reverification, like a key reset. The gateway
deletes the profile (keys and trust links go with it) and publishes `user.deleted` in the same transaction, then
deletes the Clerk account (a retry after a failure at Clerk finishes the job). Handover deletes the user's drafts
and revokes their sealed contracts (`contract.revoked`: the accessor and validators are told); released ones
stay, for their accessor. In other people's contracts the user stays named, but their keys are gone: a claim
they filed, or that would release to them as accessor, is closed (`participant_left`), and `participant.left`
asks the owner to re-seal with someone else. A departed validator is not removed: the threshold belongs to the
sealing, and the gateway's `health` shows the share as lost. The notifier forgets the user's notifications.

**Audit log.** `handover.contract_events` is append-only: triggers reject UPDATE, DELETE and TRUNCATE for every
role, and `svc_handover` can only read it and call `handover.append_event`, which numbers the event and computes
its hash in the database, in the transaction of the change it records. Format (v1):
`hash = hex(sha256(prev_hash ⏎ seq ⏎ occurred_at ⏎ contract_id ⏎ type ⏎ actor_id ⏎ body))`, joined by
newlines, `prev_hash` = 64 zeros for the first event, `actor_id` empty for the system, `body` canonical JSON
(RFC 8785) of ids and field names only (the log is kept for ever: no free text, no secret). Three
implementations agree on the shared fixture `apps/handover/src/contracts/testing/chain-v1.json`: the SQL
function, `domain/audit-chain.ts`, and the app's `lib/audit/verifyChain.ts`. The worker has handover check
every chain each night (`maintenance.audit_verify_due`); participants can check theirs
(`GET /contracts/:id/events/verify`) or verify the events themselves.

## Key flows

- **Claim.** App → gateway (`POST /contracts/:id/claims`, role and access checks) → handover command →
  transaction { claim `open`, contract `claimed`, audit event, outbox `claim.filed` } → relay → notifier
  (critical push and email to the owner, push to validators). Handover sends itself a delayed message due
  at the end of the contest window.
- **Vote.** The validator re-wraps their share on their phone → gateway → handover records the decision
  (audit, outbox) → on quorum, `claim.quorum_reached` → notifier.
- **Release.** Delayed message (or the worker's catch-up tick) → handover checks quorum and deadline →
  transaction { `released`, audit, outbox `contract.released` } → notifier tells the accessor, who fetches
  the release package through the gateway.

## End-to-end encryption (summary)

Done on the phones (`lib/crypto/` in the app); the backend stores and checks ciphertexts and signatures only.
HPKE (RFC 9180) with the hybrid post-quantum KEM X-Wing (X25519 + ML-KEM-768), Ed25519 signatures, the
contract key split among validators with Shamir secret sharing, user keys derived from a 24-word phrase.
The full protocol goes to `docs/crypto-protocol.md` (phase 4) and is audited externally before launch.

## Delivery order

0A backend foundations (monorepo, libs, schemas, messaging) → 0B app hygiene → 1 app design system →
2 notifier, worker and deployment → 3 handover and audit log → 4 keys and sealing → 5 claims and release →
6 polish and external crypto audit. Done: 0A, 0B, 1, 2 (deployment prepared: `Dockerfile`, `railway/`,
`docs/deploy.md`; email still deferred: it needs a verified domain), 3, 4, 5 (without email).
