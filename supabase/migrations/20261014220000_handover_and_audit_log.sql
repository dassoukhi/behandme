-- Phase 3: the handover service's contracts and their hash-chained audit log (docs/architecture.md).
--
-- Prerequisite: migration 20261014180000. The rows of public.contracts are copied into handover (none
-- had a sealed secret: they become drafts); public.contracts stays until a later migration drops it.
-- Tested on PGlite (apps/handover/src/migration.spec.ts) before it is applied.
begin;

-- Contracts -------------------------------------------------------------------------------------------
-- Rights: the default privileges of schema handover (20261013230000) give these tables to svc_handover.
-- User ids are Clerk ids; profiles live in the gateway (no foreign key across services).

create table handover.contracts (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  category text not null check (category in ('networks', 'devices', 'storage')),
  description text check (char_length(description) <= 280),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'claimed', 'released', 'revoked')),
  -- Bumped by every change: commands that must not overwrite a newer state compare it.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contracts_owner_idx on handover.contracts (owner_id);

-- The accessor and the validators (in order). The owner is never a participant of their own contract.
create table handover.participants (
  contract_id uuid not null references handover.contracts (id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('accessor', 'validator')),
  position smallint not null check (position >= 0),
  primary key (contract_id, user_id)
);
create unique index participants_one_accessor_idx on handover.participants (contract_id)
  where role = 'accessor';
create index participants_user_idx on handover.participants (user_id);

alter table handover.contracts enable row level security;
alter table handover.participants enable row level security;
create policy service_access on handover.contracts to svc_handover using (true) with check (true);
create policy service_access on handover.participants to svc_handover using (true) with check (true);

-- Audit log -------------------------------------------------------------------------------------------
-- One chain per contract. Each event's hash covers the previous hash, so changing, removing or
-- reordering an event breaks every hash after it. Rows are only added, through append_event below:
-- svc_handover can read the table but not write it, and triggers refuse UPDATE, DELETE and TRUNCATE
-- to every role. No foreign key: the history of a deleted draft stays.
--
-- hash = hex(sha256(utf8(prev_hash \n seq \n occurred_at \n contract_id \n type \n actor_id \n body)))
-- with prev_hash = 64 zeros for seq 1, occurred_at the exact stored string, actor_id '' for the system.
-- Verifiers: apps/handover (domain/audit-chain.ts) and the app (lib/audit/verifyChain.ts).
create table handover.contract_events (
  id bigint generated always as identity primary key,
  contract_id uuid not null,
  seq integer not null check (seq >= 1),
  type text not null check (type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  actor_id text check (actor_id !~ '[[:space:]]'),
  -- Canonical JSON (RFC 8785) of what happened: ids and field names, never a secret or free text.
  body text not null check (body::jsonb is not null),
  occurred_at text not null check (occurred_at ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'),
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  unique (contract_id, seq)
);

create function handover.forbid_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'handover.contract_events is append-only (% refused)', tg_op
    using errcode = 'insufficient_privilege';
end $$;

create trigger contract_events_no_update_delete
  before update or delete on handover.contract_events
  for each row execute function handover.forbid_event_change();
create trigger contract_events_no_truncate
  before truncate on handover.contract_events
  for each statement execute function handover.forbid_event_change();

alter table handover.contract_events enable row level security;
create policy service_read on handover.contract_events for select to svc_handover using (true);
revoke insert, update, delete, truncate on handover.contract_events from svc_handover;

-- Appends the next event of a contract's chain, inside the caller's transaction. Concurrent appends to
-- the same contract wait for each other (transaction-level advisory lock).
create function handover.append_event(
  p_contract_id uuid, p_type text, p_actor_id text, p_body text)
returns handover.contract_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_event handover.contract_events;
  next_seq integer;
  previous text;
  at_text text;
  appended handover.contract_events;
begin
  perform pg_advisory_xact_lock(hashtextextended('handover.contract_events:' || p_contract_id::text, 0));
  select * into last_event from handover.contract_events
    where contract_id = p_contract_id order by seq desc limit 1;
  next_seq := coalesce(last_event.seq, 0) + 1;
  previous := coalesce(last_event.hash, repeat('0', 64));
  at_text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into handover.contract_events
    (contract_id, seq, type, actor_id, body, occurred_at, prev_hash, hash)
  values (
    p_contract_id, next_seq, p_type, p_actor_id, p_body, at_text, previous,
    encode(sha256(convert_to(
      previous || E'\n' || next_seq || E'\n' || at_text || E'\n' || p_contract_id || E'\n' ||
      p_type || E'\n' || coalesce(p_actor_id, '') || E'\n' || p_body, 'UTF8')), 'hex'))
  returning * into appended;
  return appended;
end $$;
comment on function handover.append_event(uuid, text, text, text) is
  'The only way to add to handover.contract_events: computes seq, prev_hash and hash.';
revoke all on function handover.append_event(uuid, text, text, text) from public;
grant execute on function handover.append_event(uuid, text, text, text) to svc_handover;

-- Existing contracts ----------------------------------------------------------------------------------
-- None was ever sealed (end-to-end encryption comes with phase 4): they all become drafts, with their
-- secret_hash and meta left behind. Each starts its chain with contract.imported.

insert into handover.contracts (id, owner_id, category, description, created_at, updated_at)
select c.id, c.owner_id,
       case when c.name in ('networks', 'devices', 'storage') then c.name else 'networks' end,
       left(c.description, 280), coalesce(c.created_at, now()), coalesce(c.updated_at, now())
from public.contracts c
where c.owner_id is not null;

insert into handover.participants (contract_id, user_id, role, position)
select c.id, c.accessor_id, 'accessor', 0
from public.contracts c
where c.owner_id is not null and c.accessor_id is not null and c.accessor_id <> c.owner_id;

insert into handover.participants (contract_id, user_id, role, position)
select distinct on (c.id, v.user_id) c.id, v.user_id, 'validator', v.position::smallint
from public.contracts c, unnest(c.validators) with ordinality as v(user_id, position)
where c.owner_id is not null and v.user_id <> c.owner_id
  and v.user_id is distinct from c.accessor_id
order by c.id, v.user_id, v.position;

select handover.append_event(c.id, 'contract.imported', null, '{}')
from handover.contracts c order by c.created_at, c.id;

-- Routing ---------------------------------------------------------------------------------------------

insert into messaging.subscriptions (event_type, queue) values
  ('user.deleted', 'handover'),
  ('maintenance.audit_verify_due', 'handover'),
  ('maintenance.retention_due', 'handover');

-- Check the rights; a missing or extra one aborts and rolls everything back.
do $$
declare
  problems text[] := '{}';
  t text;
  p text;
begin
  foreach t in array array['contracts', 'participants'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('svc_handover', 'handover.' || t, p) then
        problems := problems || format('svc_handover lacks %s on handover.%s', p, t);
      end if;
    end loop;
  end loop;
  if not has_table_privilege('svc_handover', 'handover.contract_events', 'SELECT') then
    problems := problems || 'svc_handover lacks SELECT on handover.contract_events'::text;
  end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('svc_handover', 'handover.contract_events', p) then
      problems := problems || format('svc_handover can %s handover.contract_events', p);
    end if;
  end loop;
  if not has_function_privilege('svc_handover', 'handover.append_event(uuid, text, text, text)', 'EXECUTE') then
    problems := problems || 'svc_handover lacks EXECUTE on handover.append_event'::text;
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Rights are not as expected, nothing was applied: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
