-- A participant leaves a contract: they refused their role (« Refuser ce rôle » in the app), or their account was
-- deleted. The row stays, so that the owner sees who left and when; the participant no longer sees the contract
-- and is told nothing more about it, and their share or their access goes unused until the owner seals again (a
-- new sealing replaces the participants). handover.contract_events records each departure (participant.left).
--
-- Prerequisite: migration 20261014220000 (handover.participants). Two nullable columns: no existing row changes,
-- and svc_handover's rights on the table cover them. Tested on PGlite with every other migration (npm test).
-- Idempotent.
begin;

alter table handover.participants
  add column if not exists left_at timestamptz,
  add column if not exists left_reason text
    check (left_reason in ('declined', 'account_deleted'));

-- Both or neither.
alter table handover.participants drop constraint if exists participants_left_check;
alter table handover.participants
  add constraint participants_left_check check ((left_at is null) = (left_reason is null));

commit;
