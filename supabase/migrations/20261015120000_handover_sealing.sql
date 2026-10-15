-- Phase 4, step 4: sealed contracts (the app's docs/crypto-protocol.md, "Sealing"). Only ciphertexts, hashes
-- and the owner's signed manifest: the server can never read a secret or a contract key.
--
-- Prerequisite: migration 20261014220000. Tested on PGlite (apps/handover/src/migration.spec.ts).
begin;

alter table handover.contracts
  -- 0 until the first sealing; the version the current envelope, wraps and manifest belong to.
  add column sealed_version integer not null default 0 check (sealed_version >= 0),
  add column sealed_at timestamptz,
  add column revoked_at timestamptz;

-- The current sealing of a contract. Re-sealing replaces it; revoking deletes it.
create table handover.envelopes (
  contract_id uuid primary key references handover.contracts (id) on delete cascade,
  sealed_version integer not null check (sealed_version >= 1),
  -- 0x01 ‖ nonce ‖ AES-256-GCM ciphertext of the secret, under the contract key K.
  envelope bytea not null check (octet_length(envelope) between 30 and 65536),
  envelope_hash text not null check (envelope_hash ~ '^[0-9a-f]{64}$'),
  -- The manifest exactly as signed (RFC 8785 canonical JSON) and the owner's Ed25519 signature of it.
  manifest text not null check (manifest::jsonb is not null),
  manifest_signature bytea not null check (octet_length(manifest_signature) = 64),
  -- K wrapped to the owner (HPKE X-Wing, context "owner").
  owner_wrap bytea not null,
  owner_key_version integer not null,
  sealed_at timestamptz not null default now()
);

-- One share of K per validator, wrapped to that validator (context "share").
create table handover.key_wraps (
  contract_id uuid not null references handover.envelopes (contract_id) on delete cascade,
  share_index smallint not null check (share_index between 1 and 3),
  user_id text not null,
  key_version integer not null,
  wrap bytea not null,
  primary key (contract_id, share_index),
  unique (contract_id, user_id)
);

alter table handover.envelopes enable row level security;
alter table handover.key_wraps enable row level security;
create policy service_access on handover.envelopes to svc_handover using (true) with check (true);
create policy service_access on handover.key_wraps to svc_handover using (true) with check (true);

-- Rights come from the default privileges of schema handover (20261013230000); check them.
do $$
declare
  problems text[] := '{}';
  t text;
  p text;
begin
  foreach t in array array['envelopes', 'key_wraps'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('svc_handover', 'handover.' || t, p) then
        problems := problems || format('svc_handover lacks %s on handover.%s', p, t);
      end if;
    end loop;
  end loop;
  if cardinality(problems) > 0 then
    raise exception 'Rights are not as expected, nothing was applied: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
