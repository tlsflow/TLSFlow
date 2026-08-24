alter table pg_service_assets
  add column if not exists asset_kind varchar(16) not null default 'APPLICATION';

alter table pg_service_assets
  drop constraint if exists ck_pg_service_assets_asset_kind;

alter table pg_service_assets
  add constraint ck_pg_service_assets_asset_kind
  check (asset_kind in ('APPLICATION', 'DEVICE'));

create index if not exists idx_pg_service_assets_asset_kind
  on pg_service_assets (tenant_id, asset_kind, status)
  where deleted_at is null;

create table if not exists pg_device_assets (
  service_asset_id text primary key references pg_service_assets(id),
  tenant_id text not null,
  device_family varchar(64) not null check (device_family in ('NETSCALER_ADC')),
  management_port integer not null default 443 check (management_port between 1 and 65535),
  credential_id text not null,
  auth_mode varchar(24) not null default 'AUTO' check (auth_mode in ('AUTO', 'SESSION', 'PER_REQUEST')),
  tls_verify boolean not null default true,
  ca_secret_id text,
  gateway_id text,
  product_name text,
  software_version varchar(32),
  software_build text,
  runtime_mode text,
  ha_mode text,
  support_tier varchar(24) not null default 'READ_ONLY' check (support_tier in ('SUPPORTED', 'COMPATIBLE', 'READ_ONLY', 'UNSUPPORTED')),
  capability_profile jsonb not null default '{}'::jsonb,
  last_discovered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create unique index if not exists uq_pg_device_assets_identity
  on pg_device_assets (tenant_id, device_family, service_asset_id);

create index if not exists idx_pg_device_assets_family
  on pg_device_assets (tenant_id, device_family);

create table if not exists pg_device_virtual_servers (
  id text primary key,
  tenant_id text not null,
  device_asset_id text not null references pg_device_assets(service_asset_id),
  virtual_server_type varchar(16) not null check (virtual_server_type in ('LB', 'CS', 'VPN', 'GSLB')),
  virtual_server_name text not null,
  target_key text not null,
  address text,
  port integer check (port is null or port between 1 and 65535),
  protocol text,
  runtime_state text,
  sni_names jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_discovered_at timestamptz,
  status varchar(24) not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DELETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index if not exists uq_pg_device_virtual_servers_identity
  on pg_device_virtual_servers (tenant_id, device_asset_id, virtual_server_type, virtual_server_name)
  where deleted_at is null;

create index if not exists idx_pg_device_virtual_servers_device
  on pg_device_virtual_servers (tenant_id, device_asset_id, status);

create table if not exists pg_device_certificate_resources (
  id text primary key,
  tenant_id text not null,
  device_asset_id text not null references pg_device_assets(service_asset_id),
  certkey_name text not null,
  certificate_path text,
  private_key_path text,
  subject text,
  issuer text,
  serial_number text,
  not_before timestamptz,
  not_after timestamptz,
  remote_status text,
  signature_algorithm text,
  public_key_algorithm text,
  public_key_size integer,
  linked_certkey_name text,
  fingerprint_sha256 varchar(64),
  source_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  last_discovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index if not exists uq_pg_device_certificate_resources_identity
  on pg_device_certificate_resources (tenant_id, device_asset_id, certkey_name)
  where deleted_at is null;

create table if not exists pg_device_certificate_bindings (
  id text primary key,
  tenant_id text not null,
  device_asset_id text not null references pg_device_assets(service_asset_id),
  virtual_server_id text not null references pg_device_virtual_servers(id),
  certificate_resource_id text not null references pg_device_certificate_resources(id),
  binding_key text not null,
  sni_certificate boolean not null default false,
  priority integer,
  desired_certificate_version_id text,
  observed_fingerprint_sha256 varchar(64),
  desired_fingerprint_sha256 varchar(64),
  drift_state varchar(24) not null default 'UNKNOWN',
  metadata jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  last_deployed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index if not exists uq_pg_device_certificate_bindings_identity
  on pg_device_certificate_bindings (tenant_id, device_asset_id, binding_key)
  where deleted_at is null;

create index if not exists idx_pg_device_certificate_bindings_target
  on pg_device_certificate_bindings (tenant_id, virtual_server_id);
