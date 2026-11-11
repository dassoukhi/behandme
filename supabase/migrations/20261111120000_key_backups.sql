-- A user's keys backed up in a passkey (the app's docs/crypto-protocol.md, "Passkey backup"). The phone seals its
-- seed under a key only the passkey gives (WebAuthn PRF, after Face ID) and signs the box, with the time, with the
-- keys it holds; the server keeps it, cannot open it, and hands it out to a session verified again a moment ago
-- (Clerk). Handing it out publishes keys.backup_opened, a critical alert to the user. A reset of the keys
-- deletes it.
--
-- Prerequisites: migrations 20261015090000 (core) and 20261014180000 (messaging.subscriptions). Tested on
-- PGlite with every other migration (npm test). Idempotent.
begin;

create table if not exists core.key_backups (
  -- One backup per account: a new one replaces it.
  user_id text primary key references public.users (id) on delete cascade,
  -- The keys in the box: the backup counts for this version of the account's keys only.
  key_version integer not null check (key_version >= 1),
  -- The passkey whose PRF output opens the box: a WebAuthn credential id (16 to 1023 bytes), base64url.
  -- (Postgres caps a regular expression's repetition count at 255, hence the separate length.)
  credential_id text not null check (
    credential_id ~ '^[A-Za-z0-9_-]+$' and char_length(credential_id) between 22 and 1364
  ),
  -- The passkey syncs to the user's other devices (WebAuthn's backup state, as the phone saw it, signed).
  synced boolean not null,
  -- When the phone made the box (signed, within a day of the server's time): a backup only replaces an older one.
  made_at timestamptz not null,
  -- 0x01 ‖ nonce (12) ‖ AES-256-GCM of the seed and its phrase's language (33 + 16).
  box bytea not null check (octet_length(box) = 62),
  -- Ed25519, by the keys in the box, over {type: 'behyndme/v1/key-backup', user_id, key_version, credential_id,
  -- synced, made_at, box_hash}.
  signature bytea not null check (octet_length(signature) = 64)
);

alter table core.key_backups enable row level security;
drop policy if exists service_access on core.key_backups;
create policy service_access on core.key_backups to svc_gateway using (true) with check (true);

insert into messaging.subscriptions (event_type, queue)
values ('keys.backup_opened', 'notifier')
on conflict do nothing;

-- Rights come from the default privileges of schema core (20261013230000); check them.
do $$
declare
  problems text[] := '{}';
  p text;
begin
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('svc_gateway', 'core.key_backups', p) then
      problems := problems || format('svc_gateway lacks %s on core.key_backups', p);
    end if;
  end loop;
  if not exists (
    select 1 from messaging.subscriptions where event_type = 'keys.backup_opened' and queue = 'notifier'
  ) then
    problems := problems || 'keys.backup_opened is not routed to the notifier'::text;
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Not as expected, nothing was applied: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
