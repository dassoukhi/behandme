-- Knowing that users still hold their end-to-end keys while something can still be done about it. On
-- core.user_keys, for the current keys: the day the phone last proved it holds them (a signature), the
-- user's last proof that they kept their recovery phrase and how many so far, where they say they keep it
-- (a category, never the place itself), and the last reminder. Reminders: the worker asks the gateway
-- (maintenance.key_care_due), which tells the notifier (keys.care_reminder).
--
-- Prerequisite: migrations 20261015090000 (core.user_keys) and 20261014180000 (messaging.subscriptions).
-- Tested on PGlite with every other migration (npm test). Idempotent.
begin;

alter table core.user_keys
  add column if not exists proven_on timestamptz,
  add column if not exists phrase_checked_at timestamptz,
  add column if not exists phrase_checks integer not null default 0 check (phrase_checks >= 0),
  add column if not exists phrase_location text
    check (phrase_location in ('papers', 'safe', 'password_manager', 'relative', 'notary', 'other')),
  add column if not exists care_reminded_at timestamptz;

comment on column core.user_keys.proven_on is 'Midnight UTC of the day the phone last proved it holds these keys: the day only, on purpose.';

insert into messaging.subscriptions (event_type, queue)
values
  ('maintenance.key_care_due', 'gateway'),
  ('keys.care_reminder', 'notifier')
on conflict do nothing;

do $$
begin
  if (
    select count(*) from messaging.subscriptions
    where (event_type, queue) in (('maintenance.key_care_due', 'gateway'), ('keys.care_reminder', 'notifier'))
  ) <> 2 then
    raise exception 'The key care events are not routed';
  end if;
end $$;

commit;
