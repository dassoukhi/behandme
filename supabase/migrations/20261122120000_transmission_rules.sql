-- Transmission rules (decision 2 of the plan that followed the legal answers of 21 November 2026):
--   * a category for bank accounts and cryptocurrency, "finances": 15 to 30 days to cancel a claim, exactly 3
--     validators (checked by handover, which owns the participants), a handover after a death only;
--   * 15 days by default to cancel a claim, for every new envelope (7 before; existing envelopes keep theirs);
--   * handover.contracts.incapacity_allowed: the owner's explicit consent to a claim saying they can no longer act,
--     which reveals their health (GDPR article 9). False for every existing envelope: nobody was asked, so they are
--     handed over after a death only until their owner allows more. Each consent given or withdrawn is written in the
--     envelope's log (consent.incapacity);
--   * handover.claims.reason: death or incapacity, as the claimant says; null for the claims filed before.
--
-- Prerequisites: migrations 20261014220000 and 20261016150000 (handover.contracts and handover.claims). Columns and
-- constraints that every existing row meets; svc_handover's rights on both tables cover the new columns. Tested on
-- PGlite with every other migration (npm test). Idempotent.
begin;

alter table handover.contracts drop constraint if exists contracts_category_check;
alter table handover.contracts
  add constraint contracts_category_check
  check (category in ('networks', 'devices', 'storage', 'finances'));

alter table handover.contracts alter column contest_days set default 15;

alter table handover.contracts
  add column if not exists incapacity_allowed boolean not null default false;

-- What the database can see of the finances rules (the 3 validators are handover's to check).
alter table handover.contracts drop constraint if exists contracts_finances_check;
alter table handover.contracts
  add constraint contracts_finances_check
  check (category <> 'finances' or (contest_days >= 15 and not incapacity_allowed));

alter table handover.claims
  add column if not exists reason text check (reason in ('death', 'incapacity'));

commit;
