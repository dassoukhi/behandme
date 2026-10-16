-- Drops what the app used before the services, confirmed by the user (2026-10-16):
--   public.contracts      → handover.contracts (rows copied by 20261014220000)
--   public.notifications  → notify.notifications (rows copied by 20261014180000)
--   public.push_tokens    → notify.push_tokens (rows copied by 20261014180000)
--   public.orphan_tokens  → unused
--   public.get_trusted_users(text) → GET /users/me/trusteds (gateway)
-- Nothing reads or writes them since those migrations; no foreign key or trigger points at them, and their
-- policies go with them. public.users and public.trusted stay (the gateway's profiles and trust links).
--
-- Not reversible: export the rows first if you want a copy (read-only query in the report). Tested on
-- PGlite with every other migration (libs/testing/src/public-schema.spec.ts).
begin;

drop function public.get_trusted_users(text);
drop table public.orphan_tokens;
drop table public.push_tokens;
drop table public.notifications;
drop table public.contracts;

do $$
begin
  if to_regclass('public.users') is null or to_regclass('public.trusted') is null then
    raise exception 'public.users and public.trusted must stay';
  end if;
end $$;

commit;
