-- One-off cleanup (not a schema migration), after 20261111_reset_for_behyndme_labels.sql, once the app works
-- with the behyndme/v1 labels: the backup of the data that reset deleted goes. It holds test data made under the
-- old labels (ciphertexts, public keys, audit log), which nothing can use any more; no secret in clear.
--
-- Apply in the Supabase SQL editor (as postgres), like the reset.
begin;

drop schema if exists backup_20261111 cascade;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'backup_20261111') then
    raise exception 'backup_20261111 is still there, nothing was changed';
  end if;
end $$;

commit;
