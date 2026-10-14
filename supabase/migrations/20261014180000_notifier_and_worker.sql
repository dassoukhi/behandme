-- Phase 2: the notifier's and the worker's data, the routing of their events, the scheduler tick, and
-- the gateway's direct access to profiles and trust links (docs/architecture.md).
--
-- Prerequisites: migration 20261013230000 (service schemas and pgmq queues) and the pg_cron extension.
-- The rows of public.notifications and public.push_tokens are copied into notify; the public tables stay
-- until a later migration drops them, once the services run on the new ones.
-- Tested on PGlite (libs/testing/src/notifier-worker-migration.spec.ts) before it is applied.
begin;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is missing: enable it (Database > Extensions), then rerun';
  end if;
end $$;

-- Notifier ------------------------------------------------------------------------------------------
-- Rights: the default privileges of schema notify (20261013230000) give these tables to svc_notifier.

-- In-app notifications, one row per recipient. user_id is a Clerk user id; the profile lives in the
-- gateway, which tells the notifier when a user is deleted (event user.deleted).
create table notify.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox_idx on notify.notifications (user_id, created_at desc);
create index notifications_unread_idx on notify.notifications (user_id) where read_at is null;

-- Expo push tokens: a device belongs to the user signed in on it.
create table notify.push_tokens (
  token text primary key,
  user_id text not null,
  created_at timestamptz not null default now()
);
create index push_tokens_user_idx on notify.push_tokens (user_id);

-- Per-user settings; no row means the defaults.
create table notify.preferences (
  user_id text primary key,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- One push to send for a notification. Written with the notification, sent after the transaction
-- commits (an external call must not be undone by a rollback), then checked against Expo receipts.
create table notify.deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notify.notifications (id) on delete cascade,
  token text not null,
  message jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'delivered', 'failed')),
  attempts integer not null default 0,
  -- A failed send waits before the next try (backoff).
  next_attempt_at timestamptz not null default now(),
  ticket_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  checked_at timestamptz
);
create index deliveries_pending_idx on notify.deliveries (next_attempt_at) where status = 'pending';
create index deliveries_sent_idx on notify.deliveries (sent_at) where status = 'sent';
create index deliveries_notification_idx on notify.deliveries (notification_id);

alter table notify.notifications enable row level security;
alter table notify.push_tokens enable row level security;
alter table notify.preferences enable row level security;
alter table notify.deliveries enable row level security;
create policy service_access on notify.notifications to svc_notifier using (true) with check (true);
create policy service_access on notify.push_tokens to svc_notifier using (true) with check (true);
create policy service_access on notify.preferences to svc_notifier using (true) with check (true);
create policy service_access on notify.deliveries to svc_notifier using (true) with check (true);

-- Existing data. Legacy ids are text; a value that is not a uuid gets a new id.
insert into notify.notifications (id, user_id, type, title, body, data, read_at, created_at)
select
  case when n.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then n.id::uuid else gen_random_uuid() end,
  n."userId",
  coalesce(n.type, 'system'),
  n.title,
  n.message,
  n.data,
  case when n.is_read then coalesce(n.created_at, now()) end,
  coalesce(n.created_at, now())
from public.notifications n
where n."userId" is not null;

insert into notify.push_tokens (token, user_id, created_at)
select distinct on (p.token) p.token, p.user_id, coalesce(p.created_at::timestamptz, now())
from public.push_tokens p
where p.user_id is not null
order by p.token, p.created_at desc nulls last;

-- Worker --------------------------------------------------------------------------------------------

-- Each scheduled job is dispatched once per period, whatever the number of ticks or instances.
create table ops.job_runs (
  job text not null,
  period_start timestamptz not null,
  dispatched_at timestamptz not null default now(),
  primary key (job, period_start)
);
alter table ops.job_runs enable row level security;
create policy service_access on ops.job_runs to svc_worker using (true) with check (true);

-- Every minute, pg_cron puts a scheduler.tick event in the worker's queue; the worker decides which
-- jobs are due. Runs as postgres, the role that schedules it.
create function ops.send_tick()
returns bigint
language sql
set search_path = ''
as $$
  select messaging.send('worker', jsonb_build_object(
    'id', t.id,
    'type', 'scheduler.tick',
    'version', 1,
    'occurredAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'correlationId', t.id,
    'causationId', null,
    'payload', '{}'::jsonb))
  from (select gen_random_uuid()::text as id) t;
$$;
comment on function ops.send_tick() is 'Called by the pg_cron job worker-tick, every minute.';
revoke all on function ops.send_tick() from public;

select cron.schedule('worker-tick', '* * * * *', 'select ops.send_tick()');

-- Routing -------------------------------------------------------------------------------------------

insert into messaging.subscriptions (event_type, queue) values
  ('trust.added', 'notifier'),
  ('user.deleted', 'notifier'),
  ('maintenance.push_receipts_due', 'notifier'),
  ('maintenance.retention_due', 'gateway'),
  ('maintenance.retention_due', 'notifier'),
  ('maintenance.retention_due', 'worker');

-- Gateway -------------------------------------------------------------------------------------------
-- Profiles and trust links stay in public until they move to core, but the gateway now writes them
-- through its own connection, in the same transaction as the events they cause (core.outbox).

grant usage on schema public to svc_gateway;
grant select, insert, update, delete on public.users, public.trusted to svc_gateway;
create policy gateway_access on public.users to svc_gateway using (true) with check (true);
create policy gateway_access on public.trusted to svc_gateway using (true) with check (true);

-- Check the rights each service needs; a missing one aborts and rolls everything back.
do $$
declare
  c record;
  missing text[] := '{}';
begin
  for c in
    select 'svc_notifier' as role_name, format('notify.%I', t) as object, p as privilege
      from unnest(array['notifications', 'push_tokens', 'preferences', 'deliveries']) t,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    union all
    select 'svc_worker', 'ops.job_runs', p
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    union all
    select 'svc_gateway', format('public.%I', t), p
      from unnest(array['users', 'trusted']) t,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
  loop
    if not has_table_privilege(c.role_name, c.object, c.privilege) then
      missing := missing || format('%s lacks %s on %s', c.role_name, c.privilege, c.object);
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'Rights could not be granted, nothing was applied: %', array_to_string(missing, '; ');
  end if;
end $$;

commit;
