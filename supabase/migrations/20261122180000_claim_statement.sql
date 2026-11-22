-- A claim saying the owner can no longer act carries a motivated statement from whoever files it (after a digital-law
-- jurist's opinion of 22 November 2026): why, in 20 to 1,000 characters. It is health data: shown in the app to the
-- contract's participants only, never in e-mails or the log, and erased when the claim ends (handover sets it to null
-- with the claim's status). A claim for a death carries none.
--
-- Prerequisite: migration 20261122120000 (handover.claims.reason). A nullable column: no existing row changes, and
-- svc_handover's rights on the table cover it. Tested on PGlite with every other migration (npm test). Idempotent.
begin;

alter table handover.claims
  add column if not exists statement text check (char_length(statement) between 20 and 1000);

alter table handover.claims drop constraint if exists claims_statement_reason_check;
alter table handover.claims
  add constraint claims_statement_reason_check check (statement is null or reason = 'incapacity');

commit;
