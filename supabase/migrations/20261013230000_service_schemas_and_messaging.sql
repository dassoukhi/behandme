-- Service schemas, one Postgres role per service, and the messaging tables (docs/architecture.md).
--
-- Prerequisite: the pgmq extension (Supabase dashboard > Integrations > Queues). This migration creates
-- the roles without LOGIN; a service can connect only after its password is set by hand, never in git:
--   alter role svc_gateway with login password '<from the password manager>';
-- Tested on PGlite (libs/messaging/src/migration.spec.ts, messaging.spec.ts) before it is applied.
begin;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'pgmq') then
    raise exception 'pgmq is missing: enable Queues (pgmq) in the Supabase dashboard, then rerun';
  end if;
end $$;

-- Roles ---------------------------------------------------------------------------------------------

do $$
declare
  r text;
begin
  foreach r in array array['svc_gateway', 'svc_handover', 'svc_notifier', 'svc_worker'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;

-- Routing: which queue receives which event type --------------------------------------------------

create schema messaging;
revoke all on schema messaging from public;

create table messaging.subscriptions (
  event_type text not null,
  queue text not null,
  primary key (event_type, queue)
);
comment on table messaging.subscriptions is
  'Event routing read by every outbox relay. One pgmq queue per consuming service.';

alter table messaging.subscriptions enable row level security;
create policy services_read on messaging.subscriptions
  for select to svc_gateway, svc_handover, svc_notifier, svc_worker using (true);
grant usage on schema messaging to svc_gateway, svc_handover, svc_notifier, svc_worker;
grant select on messaging.subscriptions to svc_gateway, svc_handover, svc_notifier, svc_worker;

-- One schema per service, each with its outbox and its record of processed messages -----------------

do $$
declare
  svc record;
begin
  for svc in
    select * from (values
      ('core', 'svc_gateway'),
      ('handover', 'svc_handover'),
      ('notify', 'svc_notifier'),
      ('ops', 'svc_worker')
    ) as t(schema_name, role_name)
  loop
    execute format($ddl$
      create schema %1$I;
      revoke all on schema %1$I from public;
      grant usage on schema %1$I to %2$I;

      -- Events written in the same transaction as the state change they describe.
      create table %1$I.outbox (
        id bigint generated always as identity primary key,
        event_id uuid not null unique,
        type text not null,
        envelope jsonb not null,
        deliver_at timestamptz,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      );
      create index outbox_pending_idx on %1$I.outbox (id) where sent_at is null;

      -- Events already handled, so a redelivered message has no second effect.
      create table %1$I.processed_messages (
        consumer text not null,
        event_id uuid not null,
        processed_at timestamptz not null default now(),
        primary key (consumer, event_id)
      );

      alter table %1$I.outbox enable row level security;
      alter table %1$I.processed_messages enable row level security;
      create policy service_access on %1$I.outbox to %2$I using (true) with check (true);
      create policy service_access on %1$I.processed_messages to %2$I using (true) with check (true);

      grant select, insert, update, delete on all tables in schema %1$I to %2$I;
      grant usage, select on all sequences in schema %1$I to %2$I;
      -- Tables added later to this schema by migrations get the same grants.
      alter default privileges in schema %1$I grant select, insert, update, delete on tables to %2$I;
      alter default privileges in schema %1$I grant usage, select on sequences to %2$I;
    $ddl$, svc.schema_name, svc.role_name);
  end loop;
end $$;

-- Queues: one per consuming service ------------------------------------------------------------------
-- Only the service that owns a queue reads, deletes and archives its messages (pgmq functions run with
-- the caller's privileges). Sending goes through messaging.send, so a service can feed every queue
-- without being able to read the others.

select pgmq.create('gateway');
select pgmq.create('handover');
select pgmq.create('notifier');
select pgmq.create('worker');

grant usage on schema pgmq to svc_gateway, svc_handover, svc_notifier, svc_worker;
grant execute on all functions in schema pgmq to svc_gateway, svc_handover, svc_notifier, svc_worker;

do $$
declare
  q record;
begin
  for q in
    select * from (values
      ('gateway', 'svc_gateway'),
      ('handover', 'svc_handover'),
      ('notifier', 'svc_notifier'),
      ('worker', 'svc_worker')
    ) as t(queue_name, owner_role)
  loop
    execute format('alter table pgmq.%I enable row level security', 'q_' || q.queue_name);
    execute format('alter table pgmq.%I enable row level security', 'a_' || q.queue_name);
    execute format('grant select, update, delete on pgmq.%I to %I', 'q_' || q.queue_name, q.owner_role);
    execute format('grant select, insert on pgmq.%I to %I', 'a_' || q.queue_name, q.owner_role);
    execute format(
      'create policy owner_access on pgmq.%I to %I using (true) with check (true)',
      'q_' || q.queue_name, q.owner_role);
    execute format(
      'create policy owner_access on pgmq.%I to %I using (true) with check (true)',
      'a_' || q.queue_name, q.owner_role);
  end loop;
end $$;

create function messaging.send(queue_name text, message jsonb, delay_seconds integer default 0)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select pgmq.send(queue_name, message, delay_seconds);
$$;
comment on function messaging.send(text, jsonb, integer) is
  'Enqueues a message for a service. Runs as its owner so senders need no right on the queue tables.';
revoke all on function messaging.send(text, jsonb, integer) from public;
grant execute on function messaging.send(text, jsonb, integer)
  to svc_gateway, svc_handover, svc_notifier, svc_worker;

-- The public API keys never reach these schemas (they have no usage right; this states it explicitly).
do $$
declare
  s text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach s in array array['messaging', 'core', 'handover', 'notify', 'ops'] loop
      execute format('revoke all on schema %I from anon, authenticated', s);
      execute format('revoke all on all tables in schema %I from anon, authenticated', s);
    end loop;
  end if;
end $$;

-- On Supabase some pgmq objects belong to supabase_admin, and a GRANT without the grant option only
-- warns. Check the rights each service really has; a missing one aborts and rolls everything back.
do $$
declare
  c record;
  granted boolean;
  missing text[] := '{}';
begin
  for c in
    with services(role_name, schema_name, queue_name) as (
      values
        ('svc_gateway', 'core', 'gateway'),
        ('svc_handover', 'handover', 'handover'),
        ('svc_notifier', 'notify', 'notifier'),
        ('svc_worker', 'ops', 'worker')
    )
    select role_name, 'schema' as kind, s as object, 'USAGE' as privilege
      from services, unnest(array[schema_name, 'messaging', 'pgmq']) s
    union all
    select role_name, 'table', format('%I.%I', schema_name, t), p
      from services, unnest(array['outbox', 'processed_messages']) t,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    union all
    select role_name, 'table', 'messaging.subscriptions', 'SELECT' from services
    union all
    select role_name, 'table', format('pgmq.%I', 'q_' || queue_name), p
      from services, unnest(array['SELECT', 'UPDATE', 'DELETE']) p
    union all
    select role_name, 'table', format('pgmq.%I', 'a_' || queue_name), 'INSERT' from services
    union all
    select role_name, 'function', f, 'EXECUTE'
      from services, unnest(array[
        'pgmq.read(text, integer, integer)', 'pgmq.delete(text, bigint)',
        'pgmq.archive(text, bigint)', 'messaging.send(text, jsonb, integer)']) f
  loop
    granted := case c.kind
      when 'schema' then has_schema_privilege(c.role_name, c.object, c.privilege)
      when 'table' then has_table_privilege(c.role_name, c.object, c.privilege)
      else has_function_privilege(c.role_name, c.object, c.privilege)
    end;
    if not granted then
      missing := missing || format('%s lacks %s on %s', c.role_name, c.privilege, c.object);
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'Rights could not be granted, nothing was applied: %', array_to_string(missing, '; ')
      using hint = 'The role running this migration needs the grant option on the pgmq schema and functions.';
  end if;
end $$;

commit;
