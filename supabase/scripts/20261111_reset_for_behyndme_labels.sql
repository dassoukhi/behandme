-- One-off data reset (not a schema migration), before launch: the protocol's labels changed from
-- behindme/v1/… to behyndme/v1/… (app and backend, 2026-11-11). Fingerprints, signatures and wraps made
-- under the old labels no longer verify or open, so every piece of end-to-end data made with them goes:
--   keys (core.user_keys, their history, transfers), contracts and all that hangs on them (participants,
--   envelopes, wraps, claims, decisions, the audit log), notifications, and the events still waiting about
--   them (outboxes, the handover and notifier queues).
-- Kept: profiles (public.users), trust links (public.trusted), notification preferences and push tokens,
-- event routes, job runs, the gateway and worker queues (maintenance only).
-- Accounts keep working: the app makes new keys at the next start, and asks for the phrase again by role.
--
-- Apply in the Supabase SQL editor (as postgres, the tables' owner), once the backend runs the new labels.
-- Everything is copied first into the schema backup_20261111 (not exposed to the API); drop it once the app
-- works again:  drop schema backup_20261111 cascade;
begin;

-- 1. Backup of every row this script deletes.
create schema backup_20261111;
revoke all on schema backup_20261111 from public, anon, authenticated, service_role;
create table backup_20261111.user_keys as table core.user_keys;
create table backup_20261111.user_key_history as table core.user_key_history;
create table backup_20261111.key_transfers as table core.key_transfers;
create table backup_20261111.contracts as table handover.contracts;
create table backup_20261111.participants as table handover.participants;
create table backup_20261111.envelopes as table handover.envelopes;
create table backup_20261111.key_wraps as table handover.key_wraps;
create table backup_20261111.claims as table handover.claims;
create table backup_20261111.decisions as table handover.decisions;
create table backup_20261111.contract_events as table handover.contract_events;
create table backup_20261111.notifications as table notify.notifications;
create table backup_20261111.deliveries as table notify.deliveries;
create table backup_20261111.core_outbox as table core.outbox;
create table backup_20261111.handover_outbox as table handover.outbox;
create table backup_20261111.notify_outbox as table notify.outbox;
create table backup_20261111.q_handover as table pgmq.q_handover;
create table backup_20261111.q_notifier as table pgmq.q_notifier;

-- 2. The reset. The audit log refuses any change through its triggers: off for this transaction only.
alter table handover.contract_events disable trigger contract_events_no_update_delete;
alter table handover.contract_events disable trigger contract_events_no_truncate;
truncate handover.contract_events;
alter table handover.contract_events enable trigger contract_events_no_update_delete;
alter table handover.contract_events enable trigger contract_events_no_truncate;

-- participants, envelopes, key_wraps, claims and decisions go with their contracts (foreign keys).
truncate handover.contracts cascade;
truncate core.user_keys, core.user_key_history, core.key_transfers;
-- deliveries go with their notifications.
truncate notify.notifications cascade;
truncate core.outbox, handover.outbox, notify.outbox;
select pgmq.purge_queue('handover');
select pgmq.purge_queue('notifier');

-- 3. Check: nothing left, the audit log's triggers back on, the backup complete. Any failure undoes it all.
do $$
declare
  problems text[] := '{}';
  t text;
  n bigint;
begin
  foreach t in array array[
    'core.user_keys', 'core.user_key_history', 'core.key_transfers', 'handover.contracts',
    'handover.participants', 'handover.envelopes', 'handover.key_wraps', 'handover.claims',
    'handover.decisions', 'handover.contract_events', 'notify.notifications', 'notify.deliveries',
    'core.outbox', 'handover.outbox', 'notify.outbox', 'pgmq.q_handover', 'pgmq.q_notifier'
  ] loop
    execute format('select count(*) from %s', t) into n;
    if n > 0 then
      problems := problems || format('%s still has %s rows', t, n);
    end if;
  end loop;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'handover.contract_events'::regclass
      and tgname in ('contract_events_no_update_delete', 'contract_events_no_truncate')
      and tgenabled <> 'O'
  ) or (
    select count(*) from pg_trigger
    where tgrelid = 'handover.contract_events'::regclass
      and tgname in ('contract_events_no_update_delete', 'contract_events_no_truncate')
  ) <> 2 then
    problems := problems || 'the audit log''s triggers are not both on'::text;
  end if;
  if (select count(*) from information_schema.tables where table_schema = 'backup_20261111') <> 17 then
    problems := problems || 'the backup is incomplete'::text;
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Not as expected, nothing was changed: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
