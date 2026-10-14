-- Read-only snapshot of the schemas this repo manages. Run it in the Supabase SQL editor after
-- applying a migration, export the result as JSON to supabase/introspection.json, then run
-- `npm run check:schema` to compare it with the migrations replayed from scratch.
-- It reads catalog tables only: no data rows, no writes.
with
managed(nspname) as (
  values ('public'), ('messaging'), ('core'), ('handover'), ('notify'), ('ops')
),
queue_tables(relname) as (
  select prefix || queue_name
  from unnest(array['q_', 'a_']) prefix,
       unnest(array['gateway', 'handover', 'notifier', 'worker']) queue_name
),
roles(rolname) as (
  values ('anon'), ('authenticated'), ('service_role'), ('postgres'),
         ('svc_gateway'), ('svc_handover'), ('svc_notifier'), ('svc_worker')
),
cols as (
  select table_schema, table_name, column_name, ordinal_position, data_type, udt_name,
         is_nullable, column_default, character_maximum_length, is_identity
  from information_schema.columns
  where table_schema in (select nspname from managed)
),
cons as (
  select n.nspname as schema, c.conrelid::regclass::text as table_name, c.conname,
         c.contype, pg_get_constraintdef(c.oid) as definition
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname in (select nspname from managed)
),
idx as (
  select schemaname, tablename, indexname, indexdef from pg_indexes
  where schemaname in (select nspname from managed)
),
enums as (
  select n.nspname as schema, t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in (select nspname from managed) group by n.nspname, t.typname
),
funcs as (
  select n.nspname as schema, p.proname, pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef as security_definer, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (select nspname from managed) and p.prokind = 'f'
),
trigs as (
  select event_object_schema as schema, event_object_table as table_name, trigger_name,
         action_timing, event_manipulation, action_statement
  from information_schema.triggers where trigger_schema in (select nspname from managed)
),
rls as (
  select n.nspname as schema, c.relname as table_name, c.relrowsecurity as rls_enabled,
         c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and (n.nspname in (select nspname from managed)
         or (n.nspname = 'pgmq' and c.relname in (select relname from queue_tables)))
),
pols as (
  select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
  where schemaname in (select nspname from managed)
     or (schemaname = 'pgmq' and tablename in (select relname from queue_tables))
),
grants as (
  select table_schema, table_name, grantee,
         string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
  where grantee in (select rolname from roles)
    and (table_schema in (select nspname from managed)
         or (table_schema = 'pgmq' and table_name in (select relname from queue_tables)))
  group by table_schema, table_name, grantee
),
routine_grants as (
  select routine_schema, routine_name, grantee,
         string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.routine_privileges
  where grantee in (select rolname from roles) and routine_schema in (select nspname from managed)
  group by routine_schema, routine_name, grantee
),
exts as (
  select extname, extversion from pg_extension
)
select json_build_object(
  'columns',        (select json_agg(cols order by table_schema, table_name, ordinal_position) from cols),
  'constraints',    (select json_agg(cons order by schema, table_name, conname) from cons),
  'indexes',        (select json_agg(idx order by schemaname, tablename, indexname) from idx),
  'enums',          (select json_agg(enums order by schema, typname) from enums),
  'functions',      (select json_agg(funcs order by schema, proname, args) from funcs),
  'triggers',       (select json_agg(trigs order by schema, table_name, trigger_name) from trigs),
  'rls',            (select json_agg(rls order by schema, table_name) from rls),
  'policies',       (select json_agg(pols order by schemaname, tablename, policyname) from pols),
  'grants',         (select json_agg(grants order by table_schema, table_name, grantee) from grants),
  'routine_grants', (select json_agg(routine_grants order by routine_schema, routine_name, grantee)
                     from routine_grants),
  'extensions',     (select json_agg(exts order by extname) from exts)
) as schema_snapshot;
