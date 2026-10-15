-- Phase 4, key reset: route keys.rotated (gateway, core.outbox) to the notifier, which alerts the user
-- (critical) and the people who trust them. Without this row the relay drops the event with a warning.
--
-- Prerequisite: migration 20261014180000 (messaging.subscriptions). Tested on PGlite with every other
-- migration (npm test). Idempotent.
begin;

insert into messaging.subscriptions (event_type, queue)
values ('keys.rotated', 'notifier')
on conflict do nothing;

do $$
begin
  if not exists (
    select 1 from messaging.subscriptions where event_type = 'keys.rotated' and queue = 'notifier'
  ) then
    raise exception 'keys.rotated is not routed to the notifier';
  end if;
end $$;

commit;
