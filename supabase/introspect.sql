-- Read-only snapshot of the hosted schema, used to write the baseline migration.
-- Run in the Supabase SQL editor and copy the single JSON value it returns.
-- It reads catalog tables only: no data rows, no writes.
with
cols as (
  select table_schema, table_name, column_name, ordinal_position, data_type, udt_name,
         is_nullable, column_default, character_maximum_length, is_identity
  from information_schema.columns
  where table_schema = 'public'
),
cons as (
  select n.nspname as schema, c.conrelid::regclass::text as table_name, c.conname,
         c.contype, pg_get_constraintdef(c.oid) as definition
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'public'
),
idx as (
  select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname = 'public'
),
enums as (
  select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname
),
funcs as (
  select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer,
         pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
),
trigs as (
  select event_object_table as table_name, trigger_name, action_timing, event_manipulation, action_statement
  from information_schema.triggers where trigger_schema = 'public'
),
rls as (
  select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
pols as (
  select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public'
),
grants as (
  select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'postgres')
  group by table_name, grantee
),
exts as (
  select extname, extversion from pg_extension
)
select json_build_object(
  'columns',     (select json_agg(cols order by table_name, ordinal_position) from cols),
  'constraints', (select json_agg(cons order by table_name, conname) from cons),
  'indexes',     (select json_agg(idx order by tablename, indexname) from idx),
  'enums',       (select json_agg(enums) from enums),
  'functions',   (select json_agg(funcs order by proname) from funcs),
  'triggers',    (select json_agg(trigs order by table_name, trigger_name) from trigs),
  'rls',         (select json_agg(rls order by table_name) from rls),
  'policies',    (select json_agg(pols) from pols),
  'grants',      (select json_agg(grants order by table_name, grantee) from grants),
  'extensions',  (select json_agg(exts order by extname) from exts)
) as schema_snapshot;
