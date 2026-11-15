-- Adding a proche without searching the user base (the app's docs/crypto-protocol.md, "Contact code").
--
-- core.invitations: a link someone sends to a person who may not have the app yet. It is used once, within
-- seven days, by someone other than its inviter: accepting it makes the inviter trust the invitee (and the invitee
-- the inviter, if they choose), and invitation.accepted tells the inviter.
-- core.contact_codes: the QR code a user shows in person, for ten minutes. Whoever scans it reads the user's profile
-- and public keys, and compares their fingerprint with the one the code carries.
-- The server keeps only the SHA-256 of each token: a dump of these tables holds no usable link or code. The
-- gateway's daily retention deletes what has expired.
--
-- Prerequisites: migrations 20261015090000 (core) and 20261014180000 (messaging.subscriptions). Tested on
-- PGlite with every other migration (npm test). Idempotent.
begin;

create table if not exists core.invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id text not null references public.users (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by text references public.users (id) on delete set null,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  check (accepted_at is null or cancelled_at is null)
);

create index if not exists invitations_inviter_id_idx on core.invitations (inviter_id);

create table if not exists core.contact_codes (
  -- One code per account: asking for another replaces it.
  user_id text primary key references public.users (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null
);

alter table core.invitations enable row level security;
drop policy if exists service_access on core.invitations;
create policy service_access on core.invitations to svc_gateway using (true) with check (true);

alter table core.contact_codes enable row level security;
drop policy if exists service_access on core.contact_codes;
create policy service_access on core.contact_codes to svc_gateway using (true) with check (true);

insert into messaging.subscriptions (event_type, queue)
values ('invitation.accepted', 'notifier')
on conflict do nothing;

-- Rights come from the default privileges of schema core (20261013230000); check them.
do $$
declare
  problems text[] := '{}';
  tbl text;
  p text;
begin
  foreach tbl in array array['core.invitations', 'core.contact_codes'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('svc_gateway', tbl, p) then
        problems := problems || format('svc_gateway lacks %s on %s', p, tbl);
      end if;
    end loop;
  end loop;
  if not exists (
    select 1 from messaging.subscriptions where event_type = 'invitation.accepted' and queue = 'notifier'
  ) then
    problems := problems || 'invitation.accepted is not routed to the notifier'::text;
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Not as expected, nothing was applied: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
