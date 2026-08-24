create table if not exists pg_monitor_certificate_observations (
  id text primary key,
  tenant_id text,
  service_asset_id text not null,
  source text not null,
  probe_url text not null,
  observed_at timestamptz not null,
  fingerprint_sha256 text not null,
  subject text,
  issuer text,
  serial_number text,
  not_before text,
  not_after text,
  dns_names jsonb not null default '[]'::jsonb,
  verified boolean,
  verification_error text,
  raw_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists idx_pg_monitor_certificate_observations_asset
  on pg_monitor_certificate_observations (tenant_id, service_asset_id, observed_at desc);
