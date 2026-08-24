create table if not exists pg_site_assets (
  id text primary key,
  tenant_id text not null,
  service_instance_id text not null references pg_service_instances(id),
  service_asset_id text references pg_service_assets(id),
  host_id text not null references pg_hosts(id),
  agent_id text,
  provider_type varchar(64) not null,
  site_type varchar(32) not null check (site_type in ('WEB_SITE', 'VHOST', 'CONNECTOR', 'CUSTOM')),
  site_name text not null,
  site_key text not null,
  binding_information text,
  host_header text,
  listen_ip text,
  port integer check (port is null or (port between 1 and 65535)),
  protocol varchar(16) check (protocol is null or protocol in ('HTTPS', 'TLS', 'STARTTLS', 'HTTP')),
  config_path text,
  runtime_status text,
  discovery_source varchar(32) not null check (discovery_source in ('AGENT', 'SSH', 'MANUAL', 'GATEWAY', 'WINRM', 'IMPORT', 'PROVIDER')),
  last_discovered_at timestamptz,
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index if not exists uq_pg_site_assets_identity
  on pg_site_assets (tenant_id, coalesce(agent_id, ''), provider_type, site_key)
  where deleted_at is null;

create index if not exists idx_pg_site_assets_service_instance on pg_site_assets (tenant_id, service_instance_id);
create index if not exists idx_pg_site_assets_service_asset on pg_site_assets (tenant_id, service_asset_id);
create index if not exists idx_pg_site_assets_host on pg_site_assets (tenant_id, host_id);
create index if not exists idx_pg_site_assets_agent on pg_site_assets (tenant_id, agent_id);
create index if not exists idx_pg_site_assets_status on pg_site_assets (tenant_id, status);

create table if not exists pg_managed_targets (
  id text primary key,
  tenant_id text not null,
  agent_id text not null,
  host_id text not null references pg_hosts(id),
  service_instance_id text references pg_service_instances(id),
  service_asset_id text references pg_service_assets(id),
  site_asset_id text references pg_site_assets(id),
  provider_type varchar(64) not null,
  framework_type varchar(64) not null,
  target_type varchar(32) not null check (target_type in ('SITE_BINDING', 'FILE_DEPLOY', 'KEYSTORE_ENTRY', 'CUSTOM')),
  target_key text not null,
  binding_key text,
  capability_profile jsonb not null default '{}'::jsonb,
  deployment_mode text,
  last_seen_at timestamptz,
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'UNREACHABLE', 'DISABLED', 'DELETED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index if not exists uq_pg_managed_targets_identity
  on pg_managed_targets (tenant_id, agent_id, provider_type, target_type, target_key)
  where deleted_at is null;

create index if not exists idx_pg_managed_targets_host on pg_managed_targets (tenant_id, host_id);
create index if not exists idx_pg_managed_targets_service_instance on pg_managed_targets (tenant_id, service_instance_id);
create index if not exists idx_pg_managed_targets_service_asset on pg_managed_targets (tenant_id, service_asset_id);
create index if not exists idx_pg_managed_targets_site_asset on pg_managed_targets (tenant_id, site_asset_id);
create index if not exists idx_pg_managed_targets_status on pg_managed_targets (tenant_id, status);
