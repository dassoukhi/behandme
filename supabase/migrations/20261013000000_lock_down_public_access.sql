-- Lock down direct database access through the public anon key.
--
-- The anon key ships in client apps and git history, so it must grant nothing.
-- The NestJS API connects with the service_role key (which bypasses RLS) and
-- enforces per-user access itself (see src/auth/current-user.decorator.ts).
--
-- Prerequisite: the API must already run with the service_role-only
-- SupabaseService, otherwise it will start receiving empty results.

begin;

-- 1. Row Level Security on every table in public, with no policy:
--    anon and authenticated roles see and change nothing.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- 2. RPC functions are callable through /rest/v1/rpc with the anon key and may
--    be SECURITY DEFINER (bypassing RLS): restrict them to the API.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_trusted_users', 'get_contract_with_validators')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

-- 3. Functions created later are not executable by client roles by default.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
