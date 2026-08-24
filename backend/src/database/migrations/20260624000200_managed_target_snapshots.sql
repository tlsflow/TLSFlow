create table if not exists pg_managed_target_snapshots (
  id text primary key,
  tenant_id text not null,
  application_asset_id text references pg_service_assets(id),
  site_asset_id text references pg_site_assets(id),
  managed_target_id text references pg_managed_targets(id),
  certificate_binding_id text references pg_certificate_bindings(id),
  execution_run_id text,
  execution_step_id text,
  binding_information text,
  host_header text,
  port integer,
  store_location text,
  store_name text,
  store_thumbprint text,
  certificate_version_id text,
  fingerprint_sha256 text,
  snapshot_type text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1
);

create index if not exists idx_pg_managed_target_snapshots_application_asset
  on pg_managed_target_snapshots (tenant_id, application_asset_id, captured_at desc);

create index if not exists idx_pg_managed_target_snapshots_managed_target
  on pg_managed_target_snapshots (tenant_id, managed_target_id, captured_at desc);

create index if not exists idx_pg_managed_target_snapshots_execution_run
  on pg_managed_target_snapshots (tenant_id, execution_run_id, captured_at desc);
