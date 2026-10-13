-- Roles every Supabase project has, so migrations that grant or revoke on them run on PGlite.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
