create table pg_ca_capability_records (
  id text primary key,
  tenant_id text not null,
  owner_type text not null check (owner_type in ('provider', 'node')),
  owner_id text not null,
  capability_key text not null,
  state text not null check (state in ('declared', 'discovered', 'verified', 'unavailable')),
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  expires_at timestamptz,
  failure_reason text,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_ca_capability_record unique (tenant_id, owner_type, owner_id, capability_key)
);

create index idx_ca_capability_records_owner
  on pg_ca_capability_records (tenant_id, owner_type, owner_id, state);

create index idx_ca_capability_records_expiry
  on pg_ca_capability_records (tenant_id, expires_at)
  where expires_at is not null;
