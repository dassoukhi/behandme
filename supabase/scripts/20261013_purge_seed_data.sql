-- One-off data cleanup (not a schema migration): remove the seed data whose
-- participants are fake UUID users. Real accounts have Clerk ids ("user_…").
-- Backed up beforehand (all six tables exported as JSON). Expected counts on
-- 2026-10-13: contracts 15, trusted 51, notifications 19, users 50.

begin;

delete from public.contracts
where owner_id !~ '^user_'
   or accessor_id !~ '^user_'
   or exists (select 1 from unnest(validators) v where v !~ '^user_');

delete from public.trusted
where owner_id !~ '^user_' or trusted_id !~ '^user_';

delete from public.notifications where "userId" is null or "userId" !~ '^user_';
delete from public.push_tokens where user_id is not null and user_id !~ '^user_';

delete from public.users where id !~ '^user_';

commit;
