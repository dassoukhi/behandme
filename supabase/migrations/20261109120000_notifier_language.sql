-- The language new notifications are written in, per user: the app sends the one it displays. Rows
-- that exist today stay in French, the only language notifications had until now.
--
-- Prerequisite: migration 20261014180000 (notify.preferences). Tested on PGlite with every other
-- migration (npm test). Idempotent.
begin;

alter table notify.preferences
  add column if not exists language text not null default 'fr'
    check (language in ('fr', 'en'));

commit;
