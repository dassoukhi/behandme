# BehindMe backend architecture

BehindMe lets an **owner** hand a secret (social network, device or cloud access) to an **accessor**. The
secret is released only after a claim, a contest window and a quorum of trusted **validators**. The server
never sees the secret: it is encrypted end to end on the owner's phone.

This document is the target design. The monorepo layout, the dependency rules and the gateway exist today;
the other services are built phase by phase (see "Delivery order").

## Services

One NestJS app per service in `apps/`, each deployed separately. The mobile app talks to the gateway only.

| Service    | Responsibility                                                                                                                                       | Owns (Postgres schema)                                                          | Exposes                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `gateway`  | Clerk authentication, access control, response composition, public OpenAPI (`openapi.json`). Identity domain: profiles, trust links, public E2E keys | `core`: users, trusted, user_keys (+ history)                                   | Public REST API `/api/v1/*`                                     |
| `handover` | Whole contract life cycle: draft, sealing (encrypted vault), claims, votes, deadlines, release, revocation; hash-chained audit log                   | `handover`: contracts, envelopes, key_wraps, claims, decisions, contract_events | Internal API (commands and queries from the gateway) and events |
| `notifier` | In-app notifications, Expo push, Resend email, preferences, push tokens and receipts                                                                 | `notify`: notifications, push_tokens, push_tickets, preferences, dispatches     | Internal API (inbox) and event consumers                        |
| `worker`   | Scheduled and long jobs: deadline catch-up, reminders, retention, audit-log verification, push receipts, account deletion saga                       | `ops`: job_leases, runs                                                         | Nothing public; driven by pg_cron ticks and its queue           |

A service reads and writes **its own schema only**. Data owned by another service is obtained through that
service's API or kept as a local copy fed by its events.

## Communication

**Synchronous (internal HTTP)** only when the gateway needs an immediate answer for the app (file a claim and
return it, read a contract). Service-to-service calls carry a signed internal JWT (shared key, one audience
per service), use a timeout with one retry, and every command carries an **idempotency key**.

**Asynchronous (events)** for everything else:

- **Transactional outbox.** A service writes its state change and the event into `<schema>.outbox` in the
  same transaction: no lost event, no phantom event.
- **Relay** (`@lib/messaging`). Reads the outbox with `FOR UPDATE SKIP LOCKED`, sends each event to the
  pgmq queue of every subscriber (routing declared in a `subscriptions` table, one queue per consumer),
  then marks the row as sent.
- **Consumers.** Read their queue with a visibility timeout, handle each message **idempotently**
  (`processed_messages` table per service), then delete it. After N failed attempts the message is archived
  (dead letter) and an alert is raised.
- **Delayed messages.** `pgmq.send(..., delay)` for deadlines (end of the contest window, reminders).
- **Batch.** `pg_cron` enqueues "tick" messages for the worker (every minute, hour, day).
- **Envelope.** `{ id, type, version, occurredAt, correlationId, causationId, payload }`. Event schemas are
  versioned in a shared library and validated when publishing and when consuming. Examples: `trust.added`,
  `keys.rotated`, `contract.sealed`, `claim.filed`, `claim.decision_recorded`, `claim.quorum_reached`,
  `contract.released`, `contract.revoked`, `notification.requested`.
- **`MessageBus` port.** Adapters: `PgmqBus` (production) and `InMemoryBus` (tests). A broker such as
  RabbitMQ or NATS can replace pgmq later without touching domain code.

## Inside a service: clean architecture

```
apps/<service>/src/<module>/
  domain/          entities, value objects, pure rules (state machine, threshold, health). No dependency.
  application/     use cases (commands, queries) and the ports they need (repositories, bus, clock, clients)
  infrastructure/  adapters: Kysely repositories, PgmqBus, Expo push, Resend, Clerk, internal HTTP clients
  interface/       HTTP controllers, message consumers, jobs
  <module>.module.ts   wires the layers (the only file allowed to see all of them)
libs/
  kernel/          Clock, ids, business errors, structured logger (correlationId)
  messaging/       MessageBus port, envelope, outbox relay, idempotent consumer, retries
  persistence/     Kysely + pg (Supabase pooler), unit of work (transaction + outbox)
  testing/         InMemoryBus, fake clock, PGlite harness, fixtures
```

`npm run check:deps` (dependency-cruiser) enforces the direction of dependencies: domain ← application ←
infrastructure / interface, no service importing another, libs never importing apps.

**Data access.** Direct Postgres connection through the Supabase pooler with Kysely (typed queries, real
transactions). One Postgres role per service, limited to its schema. RLS stays enabled everywhere and the
public anon key has no access. The gateway still uses supabase-js on `public` until its modules move.

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

k = ⌊n/2⌋ + 1 for n validators. The gateway returns `my_role`, `allowed_actions`, `open_claim`, `threshold`
and `health` so the app implements no rule itself. Revocation and cancellation are always decided by
handover, the single authority on the life cycle, which removes "revoke vs release" races.

**Audit log.** `handover.contract_events` is append-only (triggers reject UPDATE, DELETE, TRUNCATE), each row
holds `prev_hash` and `hash` (SHA-256 of canonical JSON) and is written in the same transaction as the
transition. The worker verifies the chain every night; the app ships the same verifier.

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
6 polish and external crypto audit.
