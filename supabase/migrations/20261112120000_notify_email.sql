-- Notifications by e-mail. The notifier gets:
--   * notify.people, its copy of each user's address and name: the gateway publishes user.profile_changed
--     at each sync of a profile (sign-in), user.deleted empties the row. email is null while the address
--     is not verified: no e-mail then;
--   * notify.email_deliveries, one e-mail to send per notification, written with the notification and sent
--     after the transaction commits (content: the subject, greeting, paragraphs and facts, written when the
--     event happened);
--   * two settings in notify.preferences: e-mail for non-critical notifications (critical ones always go),
--     and the time zone of the user's phone, for the dates e-mails give.
--
-- Prerequisite: migrations 20261014180000 (schema notify, messaging.subscriptions) and 20261109120000
-- (notify.preferences.language). Tested on PGlite with every other migration (npm test). Idempotent.
begin;

create table if not exists notify.people (
  user_id text primary key,
  email text,
  first_name text,
  last_name text,
  -- When the gateway saw this version (the event's time): an older event, retried late, never overwrites
  -- a newer one.
  occurred_at timestamptz not null default 'epoch',
  -- The account is gone: the row keeps no address or name, only so that a late event cannot bring them
  -- back. Deleted by the retention job a month later.
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists notify.email_deliveries (
  notification_id uuid primary key references notify.notifications (id) on delete cascade,
  to_address text not null,
  content jsonb not null,
  -- 'sending': a sender took it until next_attempt_at; past that, another may take it again.
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists email_deliveries_due_idx
  on notify.email_deliveries (next_attempt_at) where status in ('pending', 'sending');
create index if not exists email_deliveries_finished_idx
  on notify.email_deliveries (finished_at) where status in ('sent', 'failed');

alter table notify.preferences
  add column if not exists email_enabled boolean not null default true;
alter table notify.preferences
  add column if not exists time_zone text not null default 'Europe/Paris'
    check (char_length(time_zone) between 1 and 64);

alter table notify.people enable row level security;
alter table notify.email_deliveries enable row level security;
drop policy if exists service_access on notify.people;
drop policy if exists service_access on notify.email_deliveries;
create policy service_access on notify.people to svc_notifier using (true) with check (true);
create policy service_access on notify.email_deliveries to svc_notifier using (true) with check (true);
-- Also given by the schema's default privileges (20261013230000); explicit for a reader of this file.
grant select, insert, update, delete on notify.people, notify.email_deliveries to svc_notifier;

insert into messaging.subscriptions (event_type, queue)
values ('user.profile_changed', 'notifier')
on conflict do nothing;

-- The users who exist today: their address and name, as the gateway holds them.
insert into notify.people (user_id, email, first_name, last_name)
select id, email, first_name, last_name from public.users
on conflict (user_id) do nothing;

do $$
begin
  if not exists (
    select 1 from messaging.subscriptions where event_type = 'user.profile_changed' and queue = 'notifier'
  ) then
    raise exception 'user.profile_changed is not routed to the notifier';
  end if;
  if exists (
    select 1 from public.users u where not exists (select 1 from notify.people p where p.user_id = u.id)
  ) then
    raise exception 'notify.people misses users of public.users';
  end if;
end $$;

commit;
