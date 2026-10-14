-- The API (service_role) is the only client of the database. The anon and authenticated keys see no
-- row already (RLS on, no policy), yet they still held every table privilege: TRUNCATE is not covered
-- by RLS, and the GraphQL endpoint describes every table those roles may access. Take it all back,
-- for existing objects and for those created later in public.
--
-- Prerequisite: none (the app never uses these keys; the API and edge functions use service_role).
-- To undo the rights part: grant all on all tables in schema public to anon, authenticated.
-- Tested on PGlite (libs/testing/src/public-schema.spec.ts) before it is applied.
begin;

revoke all on all tables in schema public from anon, authenticated;
-- public has no sequence, and 20261013000000 already limited its functions to service_role.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
-- New functions: 20261013000000 took EXECUTE back from anon and authenticated in public, but EXECUTE for
-- PUBLIC is a global default that a per-schema rule cannot revoke. Revoke it globally: functions postgres
-- creates from now on run only for roles granted explicitly, as messaging.send already is.
alter default privileges for role postgres revoke execute on functions from public;

-- Reads the blockchain_* columns dropped by 20261013120000, so it fails on every call; nothing calls it.
drop function public.get_contract_with_validators(uuid);

-- Same column and target as trusted_trusted_id_fkey, which cascades: this copy only duplicates it.
alter table public.trusted drop constraint trusted_trusted_id_fkey1;

commit;
