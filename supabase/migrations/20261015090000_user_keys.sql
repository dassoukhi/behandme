-- Phase 4, step 2: users' public end-to-end keys (docs/crypto-protocol.md in the app repo, "Identity keys").
--
-- Only public keys and their signed registration: private keys never leave the phones. Owned by the gateway
-- (schema core); deleted with the profile. Tested on PGlite (apps/gateway/src/keys/keys.spec.ts) before it
-- is applied.
begin;

create table core.user_keys (
  user_id text primary key references public.users (id) on delete cascade,
  key_version integer not null check (key_version >= 1),
  -- X-Wing public key (1216 bytes) and Ed25519 public key (32 bytes).
  kem_public_key bytea not null check (octet_length(kem_public_key) = 1216),
  signing_public_key bytea not null check (octet_length(signing_public_key) = 32),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  -- Ed25519 by the signing key over the registration statement: the user, not the server, chose these keys.
  signature bytea not null check (octet_length(signature) = 64),
  -- Others may encrypt to the keys from then on (later than created_at after a reset: quarantine).
  usable_from timestamptz not null,
  created_at timestamptz not null default now()
);

-- Keys a user had before a reset, kept to explain old signatures and for the audit. Rows are never changed;
-- they go with the profile.
create table core.user_key_history (
  id bigint generated always as identity primary key,
  user_id text not null references public.users (id) on delete cascade,
  key_version integer not null,
  kem_public_key bytea not null,
  signing_public_key bytea not null,
  fingerprint text not null,
  signature bytea not null,
  created_at timestamptz not null,
  retired_at timestamptz not null default now(),
  reason text not null check (reason in ('reset')),
  unique (user_id, key_version)
);

create function core.forbid_key_history_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'core.user_key_history rows are never changed' using errcode = 'insufficient_privilege';
end $$;
create trigger user_key_history_no_update
  before update on core.user_key_history
  for each row execute function core.forbid_key_history_update();

alter table core.user_keys enable row level security;
alter table core.user_key_history enable row level security;
create policy service_access on core.user_keys to svc_gateway using (true) with check (true);
create policy service_access on core.user_key_history to svc_gateway using (true) with check (true);

-- Rights come from the default privileges of schema core (20261013230000); check them.
do $$
declare
  problems text[] := '{}';
  t text;
  p text;
begin
  foreach t in array array['user_keys', 'user_key_history'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('svc_gateway', 'core.' || t, p) then
        problems := problems || format('svc_gateway lacks %s on core.%s', p, t);
      end if;
    end loop;
  end loop;
  if cardinality(problems) > 0 then
    raise exception 'Rights are not as expected, nothing was applied: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
