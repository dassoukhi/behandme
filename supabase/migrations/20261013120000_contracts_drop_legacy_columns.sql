-- Contracts no longer accept client-provided secret or blockchain fields
-- (the API stops sending them). Fabric is removed, so its columns go;
-- secret_hash becomes nullable until it is replaced by sealed envelopes.
-- Prerequisite: deploy the API version that no longer writes these columns.

begin;

alter table public.contracts drop column if exists blockchain_tx_id;
alter table public.contracts drop column if exists blockchain_network;
alter table public.contracts alter column secret_hash drop not null;

commit;
