-- The owner may give themselves up to 3 months (90 days) to cancel a claim, instead of 30 days; at least 3 days, as
-- before (finances: at least 15, contracts_finances_check). Every existing envelope meets the new rule: none changes.
--
-- Prerequisite: migration 20261016150000 (handover.contracts.contest_days). Tested on PGlite with every other
-- migration (npm test). Idempotent.
begin;

alter table handover.contracts drop constraint if exists contracts_contest_days_check;
alter table handover.contracts
  add constraint contracts_contest_days_check check (contest_days between 3 and 90);

commit;
