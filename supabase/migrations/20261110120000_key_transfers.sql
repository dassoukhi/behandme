-- Moving a user's keys from their old phone to a new one, without the recovery phrase (the app's
-- docs/crypto-protocol.md, "Moving keys to a new phone"). The new phone opens a transfer with a public key
-- made for it alone; the old phone, after Face ID, deposits the seed encrypted to that key; the new phone
-- takes it, once. The server cannot open it: it relays, for five minutes, between two sessions of the same
-- account. keys.transferred alerts the user (critical push).
--
-- Prerequisites: migrations 20261015090000 (core) and 20261014180000 (messaging.subscriptions). Tested on
-- PGlite with every other migration (npm test). Idempotent.
begin;

create table if not exists core.key_transfers (
  id uuid primary key default gen_random_uuid(),
  -- One transfer per account: opening another replaces it, under a new id.
  user_id text not null unique references public.users (id) on delete cascade,
  -- X-Wing public key the new phone made for this transfer only.
  recipient_key bytea not null check (octet_length(recipient_key) = 1216),
  -- The account's key version when the transfer was opened: the seed must be of these keys.
  key_version integer not null check (key_version >= 1),
  -- 0x01 ‖ X-Wing ciphertext (1120) ‖ AES-256-GCM of the seed and its phrase's language (33 + 16).
  wrap bytea check (wrap is null or octet_length(wrap) = 1170),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table core.key_transfers enable row level security;
drop policy if exists service_access on core.key_transfers;
create policy service_access on core.key_transfers to svc_gateway using (true) with check (true);

insert into messaging.subscriptions (event_type, queue)
values ('keys.transferred', 'notifier')
on conflict do nothing;

-- Rights come from the default privileges of schema core (20261013230000); check them.
do $$
declare
  problems text[] := '{}';
  p text;
begin
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('svc_gateway', 'core.key_transfers', p) then
      problems := problems || format('svc_gateway lacks %s on core.key_transfers', p);
    end if;
  end loop;
  if not exists (
    select 1 from messaging.subscriptions where event_type = 'keys.transferred' and queue = 'notifier'
  ) then
    problems := problems || 'keys.transferred is not routed to the notifier'::text;
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Not as expected, nothing was applied: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
