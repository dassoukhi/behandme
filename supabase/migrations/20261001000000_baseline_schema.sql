-- Baseline: the public schema as the hosted project had it before this repo tracked migrations,
-- rebuilt from supabase/introspection.json (supabase/introspect.sql). It lets the test database
-- replay every migration from scratch and `npm run check:schema` compare the result with the
-- hosted project.
--
-- DO NOT RUN IT ON THE HOSTED PROJECT: it already has these tables. It fails on the first
-- `create table` there and, being one transaction, changes nothing.
--
-- The blockchain_* columns and NOT NULL on secret_hash that 20261013120000 removes are already
-- gone, as in the snapshot; that migration uses `if exists` and replays as a no-op.
begin;

create table public.users (
  id text not null,
  email text not null,
  first_name text,
  last_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  phone_number text,
  constraint users_pkey primary key (id)
);

create table public.contracts (
  id uuid not null default gen_random_uuid(),
  owner_id text,
  secret_hash text,
  accessor_id text,
  validators text[] not null,
  status text default 'draft',
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now()),
  meta jsonb,
  name text not null,
  description text,
  constraint contracts_pkey primary key (id),
  constraint contracts_owner_id_fkey foreign key (owner_id) references public.users (id) on delete cascade,
  constraint contracts_accessor_id_fkey foreign key (accessor_id) references public.users (id),
  constraint contracts_status_check
    check (status in ('draft', 'active', 'validated', 'released', 'revoked', 'pending')),
  constraint contracts_validators_check check (array_length(validators, 1) <= 3)
);

create table public.trusted (
  id uuid not null default gen_random_uuid(),
  owner_id text not null,
  trusted_id text not null,
  created_at timestamptz default timezone('utc', now()),
  constraint trusted_pkey primary key (id),
  constraint trusted_owner_id_trusted_id_key unique (owner_id, trusted_id),
  constraint trusted_owner_id_fkey foreign key (owner_id) references public.users (id) on delete cascade,
  constraint trusted_trusted_id_fkey foreign key (trusted_id) references public.users (id) on delete cascade,
  -- A second foreign key on the same column, without cascade (as in the hosted schema).
  constraint trusted_trusted_id_fkey1 foreign key (trusted_id) references public.users (id)
);

create table public.notifications (
  id text not null default gen_random_uuid(),
  "userId" text,
  title text not null,
  message text not null,
  type text default 'system',
  is_read boolean default false,
  created_at timestamptz default timezone('utc', now()),
  scheduled_at timestamptz,
  meta jsonb,
  data jsonb not null,
  constraint notifications_pkey primary key (id),
  constraint "notifications_userId_fkey" foreign key ("userId") references public.users (id) on delete cascade,
  constraint notifications_type_check
    check (type in ('contract_created', 'contract_updated', 'reminder', 'system', 'info', 'warning'))
);

create table public.push_tokens (
  id text not null default gen_random_uuid(),
  user_id text,
  token text not null,
  created_at timestamp default now(),
  constraint push_tokens_pkey primary key (id),
  constraint push_tokens_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade
);

create table public.orphan_tokens (
  id text not null default gen_random_uuid(),
  token text not null,
  created_at timestamp default now(),
  constraint orphan_tokens_pkey primary key (id)
);

-- Supabase's default privileges gave every API role full rights on new tables in public.
grant all on all tables in schema public to anon, authenticated, service_role;

-- Function bodies are byte for byte the hosted ones, trailing spaces included: check:schema compares them.
create or replace function public.get_trusted_users(owner_uuid text)
 returns setof users
 language sql
as $function$
  SELECT u.* 
  FROM trusted t
  JOIN users u ON t.trusted_id = u.id
  WHERE t.owner_id = owner_uuid;
$function$;

-- Still reads the blockchain_* columns dropped by 20261013120000: broken, and called by nothing.
create or replace function public.get_contract_with_validators(contract_id uuid)
 returns json
 language plpgsql
as $function$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'id', c.id,
    'name', c.name,
    'description', c.description,
    'owner_id', c.owner_id,
    'secret_hash', c.secret_hash,
    'blockchain_tx_id', c.blockchain_tx_id,
    'blockchain_network', c.blockchain_network,
    'accessor_id', c.accessor_id,
    'validators', c.validators,
    'status', c.status,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'meta', c.meta,
    'owner', row_to_json(owner.*),
    'accessor', row_to_json(accessor.*),
    'validators_list', (
      SELECT json_agg(u.*)
      FROM users u
      WHERE u.id = ANY(c.validators)
      ORDER BY array_position(c.validators, u.id)
    )
  ) INTO result
  FROM contracts c
  LEFT JOIN users owner ON owner.id = c.owner_id
  LEFT JOIN users accessor ON accessor.id = c.accessor_id
  WHERE c.id = contract_id;
  
  RETURN result;
END;
$function$;

commit;
