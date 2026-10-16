-- Phase 5: claims, validators' decisions and release (docs/architecture.md, "Contract life cycle"; the app's
-- docs/crypto-protocol.md, "Reading and release"). Only ciphertexts: a decision to approve carries the
-- validator's share re-wrapped to the accessor, which the server cannot open.
--
-- Prerequisites: migrations 20261015120000 (sealing) and 20261014180000 (messaging routing). Tested on PGlite
-- with every other migration (npm test).
begin;

alter table handover.contracts
  -- How long the owner has to cancel a claim ("I'm here").
  add column contest_days integer not null default 7 check (contest_days between 3 and 30),
  add column released_at timestamptz;

create table handover.claims (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references handover.contracts (id) on delete cascade,
  claimant_id text not null,
  -- The sealing the claim is about: a re-sealing is impossible while a claim is open.
  sealed_version integer not null check (sealed_version >= 1),
  status text not null default 'open'
    check (status in ('open', 'cancelled', 'withdrawn', 'rejected', 'expired', 'released')),
  filed_at timestamptz not null default now(),
  contest_until timestamptz not null,
  expires_at timestamptz not null,
  closed_at timestamptz,
  -- Who closed it; null for the system (rejections, expiry, release).
  closed_by text,
  check ((status = 'open') = (closed_at is null))
);
-- One open claim per contract.
create unique index claims_one_open on handover.claims (contract_id) where status = 'open';
create index claims_open_due on handover.claims (contest_until) where status = 'open';
create index claims_by_claimant on handover.claims (contract_id, claimant_id, closed_at desc);

create table handover.decisions (
  claim_id uuid not null references handover.claims (id) on delete cascade,
  validator_id text not null,
  approve boolean not null,
  decided_at timestamptz not null default now(),
  share_index smallint check (share_index between 1 and 3),
  accessor_key_version integer,
  -- Approve only; erased when the claim closes without release.
  release_wrap bytea,
  primary key (claim_id, validator_id),
  check (approve or (share_index is null and accessor_key_version is null and release_wrap is null)),
  check (not approve or (share_index is not null and accessor_key_version is not null))
);

alter table handover.claims enable row level security;
alter table handover.decisions enable row level security;
create policy service_access on handover.claims to svc_handover using (true) with check (true);
create policy service_access on handover.decisions to svc_handover using (true) with check (true);

-- Routing ---------------------------------------------------------------------------------------------

insert into messaging.subscriptions (event_type, queue) values
  ('claim.filed', 'notifier'),
  ('claim.quorum_reached', 'notifier'),
  ('claim.closed', 'notifier'),
  ('claim.reminder', 'notifier'),
  ('contract.released', 'notifier'),
  ('claim.deadline_due', 'handover'),
  ('claim.reminder_due', 'handover'),
  ('maintenance.claims_due', 'handover')
on conflict do nothing;

-- Rights come from the default privileges of schema handover (20261013230000); check them.
do $$
declare
  problems text[] := '{}';
  t text;
  p text;
begin
  foreach t in array array['claims', 'decisions'] loop
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
