-- pg_cron 1.6 cannot run on PGlite. Same schedule/unschedule signatures, but jobs are only recorded
-- in cron.job, so tests can read a job's command and run it themselves.
create schema cron;

create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique,
  schedule text not null,
  command text not null
);

create function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;

create function cron.unschedule(job_name text)
returns boolean
language sql
as $$
  with removed as (delete from cron.job where jobname = job_name returning 1)
  select exists (select 1 from removed);
$$;
