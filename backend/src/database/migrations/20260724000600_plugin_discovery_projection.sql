alter table pg_device_assets
  drop constraint if exists pg_device_assets_device_family_check;

alter table pg_device_assets
  add constraint ck_pg_device_assets_device_family_nonempty
  check (length(trim(device_family)) > 0);

alter table pg_device_assets
  add column if not exists plugin_version_id text references unified_plugin_versions(id),
  add column if not exists plugin_binding_id text references unified_plugin_bindings(id),
  add column if not exists product_family text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists plugin_discovery_snapshots (
  id text primary key,
  tenant_id text not null,
  device_asset_id text not null references pg_device_assets(service_asset_id),
  plugin_version_id text not null references unified_plugin_versions(id),
  plugin_binding_id text references unified_plugin_bindings(id),
  normalized_sha256 varchar(64) not null,
  status varchar(16) not null check (status in ('SUCCEEDED', 'FAILED')),
  summary jsonb not null default '{}'::jsonb,
  payload jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_plugin_discovery_snapshots_device
  on plugin_discovery_snapshots (tenant_id, device_asset_id, created_at desc);

create table if not exists plugin_discovered_certificates (
  id text primary key,
  tenant_id text not null,
  device_asset_id text not null references pg_device_assets(service_asset_id),
  stable_key text not null,
  fingerprint_sha256 varchar(64),
  subject text,
  issuer text,
  not_after timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  status varchar(16) not null default 'ACTIVE' check (status in ('ACTIVE', 'STALE')),
  last_discovered_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, device_asset_id, stable_key)
);

create table if not exists plugin_discovered_certificate_bindings (
  id text primary key,
  tenant_id text not null,
  device_asset_id text not null references pg_device_assets(service_asset_id),
  stable_key text not null,
  site_asset_id text not null references pg_site_assets(id),
  discovered_certificate_id text not null references plugin_discovered_certificates(id),
  binding_name text,
  metadata jsonb not null default '{}'::jsonb,
  status varchar(16) not null default 'ACTIVE' check (status in ('ACTIVE', 'STALE')),
  last_discovered_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, device_asset_id, stable_key)
);
