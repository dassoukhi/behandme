-- Route contract.sealed (handover, handover.outbox) to the notifier, which tells those named validators
-- for the first time that someone counts on them. Without this row the relay drops the event with a warning.
--
-- Prerequisite: migration 20261014180000 (messaging.subscriptions). Tested on PGlite with every other
-- migration (npm test). Idempotent.
begin;

insert into messaging.subscriptions (event_type, queue)
values ('contract.sealed', 'notifier')
on conflict do nothing;

do $$
begin
  if not exists (
    select 1 from messaging.subscriptions where event_type = 'contract.sealed' and queue = 'notifier'
  ) then
    raise exception 'contract.sealed is not routed to the notifier';
  end if;
end $$;

commit;
