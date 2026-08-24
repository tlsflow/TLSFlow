-- 正式业务持久化表：专门承接证书、资产、绑定与证书产物
-- 说明：现有核心表使用 uuid 主键，和当前运行时代码里的字符串 ID 不兼容，所以这里单独建 pg_* 表
-- 原则：这些表才是正式 PostgreSQL 读写入口，不再走内存镜像或 app_documents 过渡层

create table pg_certificate_assets (
  id text primary key,
  name varchar(256) not null,
  primary_domain varchar(255) not null,
  sans jsonb not null default '[]'::jsonb,
  source_type varchar(32) not null,
  current_version_id text,
  status varchar(32) not null,
  tags jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_pg_certificate_assets_status on pg_certificate_assets (status);
create index idx_pg_certificate_assets_primary_domain on pg_certificate_assets (primary_domain);

create table pg_certificate_versions (
  id text primary key,
  certificate_asset_id text not null references pg_certificate_assets(id),
  version_no integer not null,
  common_name varchar(255),
  sans jsonb not null default '[]'::jsonb,
  issuer jsonb not null,
  subject jsonb not null,
  serial_number varchar(128) not null,
  not_before timestamptz not null,
  not_after timestamptz not null,
  fingerprint_sha256 char(64) not null,
  public_key_algorithm varchar(128) not null,
  signature_algorithm varchar(128) not null,
  leaf_storage_ref text not null,
  private_key_secret_ref text,
  chain_certificate_refs jsonb not null default '[]'::jsonb,
  chain_order jsonb not null default '[]'::jsonb,
  chain_diagnostics jsonb not null default '[]'::jsonb,
  chain_status varchar(32) not null,
  deployable boolean not null default false,
  source_type varchar(32) not null,
  status varchar(32) not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_pg_certificate_versions_asset_version on pg_certificate_versions (certificate_asset_id, version_no);
create unique index uq_pg_certificate_versions_fingerprint on pg_certificate_versions (fingerprint_sha256);
create index idx_pg_certificate_versions_asset on pg_certificate_versions (certificate_asset_id, status);
create index idx_pg_certificate_versions_not_after on pg_certificate_versions (not_after);

create table pg_certificate_version_formats (
  id text primary key,
  certificate_version_id text not null references pg_certificate_versions(id),
  format varchar(32) not null,
  artifact_ref text not null,
  parameter_hash char(64) not null,
  contains_private_key boolean not null default false,
  password_secret_ref text,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create unique index uq_pg_certificate_version_formats_natural on pg_certificate_version_formats (certificate_version_id, format, parameter_hash);
create index idx_pg_certificate_version_formats_version on pg_certificate_version_formats (certificate_version_id, created_at desc);

create table pg_certificate_artifacts (
  artifact_ref text primary key,
  content bytea not null,
  content_type text not null,
  sha256 char(64) not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index idx_pg_certificate_artifacts_created_at on pg_certificate_artifacts (created_at desc);

create table pg_hosts (
  id text primary key,
  tenant_id text not null,
  hostname varchar(255),
  display_name varchar(255),
  primary_ip text,
  ip_addresses jsonb not null default '[]'::jsonb,
  os_type varchar(32) not null,
  os_name varchar(128),
  os_version varchar(128),
  arch varchar(64),
  environment varchar(32),
  zone_id text,
  owner_id text,
  management_channels jsonb not null default '[]'::jsonb,
  discovery_source varchar(32) not null,
  last_discovered_at timestamptz,
  agent_id text,
  asset_fingerprint text,
  compatibility_level varchar(8) not null,
  management_mode varchar(32) not null,
  status varchar(32) not null,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index uq_pg_hosts_active_hostname on pg_hosts (tenant_id, hostname) where deleted_at is null and hostname is not null;
create unique index uq_pg_hosts_active_primary_ip on pg_hosts (tenant_id, primary_ip) where deleted_at is null and primary_ip is not null;
create unique index uq_pg_hosts_active_agent_id on pg_hosts (tenant_id, agent_id) where deleted_at is null and agent_id is not null;
create unique index uq_pg_hosts_active_asset_fingerprint on pg_hosts (tenant_id, asset_fingerprint) where deleted_at is null and asset_fingerprint is not null;
create index idx_pg_hosts_tenant_status on pg_hosts (tenant_id, status);

create table pg_service_instances (
  id text primary key,
  tenant_id text not null,
  host_id text not null,
  provider_type varchar(64) not null,
  service_name varchar(128),
  display_name varchar(255) not null,
  version_text varchar(128),
  install_path text,
  config_path text,
  runtime_user varchar(128),
  ports jsonb not null default '[]'::jsonb,
  provider_key text,
  manual_overrides jsonb not null default '{}'::jsonb,
  discovery_source varchar(32) not null,
  last_discovered_at timestamptz,
  status varchar(32) not null,
  raw_facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index idx_pg_service_instances_host_provider on pg_service_instances (tenant_id, host_id, provider_type);
create index idx_pg_service_instances_status on pg_service_instances (tenant_id, status);
create unique index uq_pg_service_instances_identity on pg_service_instances (
  tenant_id,
  host_id,
  provider_type,
  coalesce(service_name, ''),
  coalesce(config_path, '')
) where deleted_at is null;

create table pg_service_endpoints (
  id text primary key,
  tenant_id text not null,
  service_instance_id text not null references pg_service_instances(id),
  host_id text not null,
  protocol varchar(16) not null,
  host_name varchar(255),
  listen_ip text,
  port integer not null,
  path_hint text,
  status varchar(32) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index idx_pg_service_endpoints_host_port on pg_service_endpoints (tenant_id, host_name, port);
create index idx_pg_service_endpoints_status on pg_service_endpoints (tenant_id, status);

create table pg_discovery_snapshots (
  id text primary key,
  tenant_id text not null,
  normalized_hash varchar(128) not null,
  source varchar(32) not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create unique index uq_pg_discovery_snapshots_hash on pg_discovery_snapshots (tenant_id, normalized_hash);
create index idx_pg_discovery_snapshots_tenant on pg_discovery_snapshots (tenant_id, created_at desc);

create table pg_asset_conflicts (
  id text primary key,
  tenant_id text not null,
  resource_type varchar(32) not null,
  resource_id text not null,
  field varchar(128) not null,
  current_value jsonb,
  discovered_value jsonb,
  source_snapshot_id text not null,
  status varchar(32) not null,
  resolved_by text,
  resolved_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index idx_pg_asset_conflicts_tenant_status on pg_asset_conflicts (tenant_id, status);
create unique index uq_pg_asset_conflicts_open on pg_asset_conflicts (
  tenant_id,
  resource_type,
  resource_id,
  field,
  source_snapshot_id
) where status = 'open';

create table pg_certificate_bindings (
  id text primary key,
  tenant_id text not null,
  service_instance_id text not null references pg_service_instances(id),
  service_endpoint_id text,
  host_id text not null,
  domain_name varchar(255),
  domain varchar(255),
  port integer,
  protocol varchar(32),
  binding_key varchar(512) not null,
  binding_type varchar(32) not null,
  certificate_version_id text references pg_certificate_versions(id),
  target_certificate_version_id text,
  local_certificate_version_id text,
  observed_fingerprint_sha256 char(64),
  desired_fingerprint_sha256 char(64),
  target_fingerprint_sha256 char(64),
  unmanaged_certificate_fingerprint char(64),
  cert_path text,
  key_path text,
  chain_path text,
  keystore_path text,
  keystore_type varchar(32),
  store_location varchar(64),
  store_name varchar(64),
  store_thumbprint varchar(128),
  reload_command text,
  reload_hint jsonb,
  discovery_source varchar(32),
  verify_method varchar(32) not null,
  local_config_fingerprint char(64),
  local_config_path text,
  remote_endpoint_fingerprint char(64),
  remote_status varchar(32),
  tls_version varchar(64),
  chain_summary jsonb,
  checked_at timestamptz,
  drift_status varchar(32),
  last_verified_at timestamptz,
  last_deployed_at timestamptz,
  status varchar(32) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create index idx_pg_certificate_bindings_domain on pg_certificate_bindings (tenant_id, domain_name);
create index idx_pg_certificate_bindings_observed_fp on pg_certificate_bindings (tenant_id, observed_fingerprint_sha256);
create index idx_pg_certificate_bindings_desired_fp on pg_certificate_bindings (tenant_id, desired_fingerprint_sha256);
create index idx_pg_certificate_bindings_status_verified on pg_certificate_bindings (tenant_id, status, last_verified_at);
create unique index uq_pg_certificate_bindings_file_active
  on pg_certificate_bindings (tenant_id, service_instance_id, coalesce(domain_name, ''), cert_path)
  where deleted_at is null and binding_type = 'FILE_PATH';
create unique index uq_pg_certificate_bindings_keystore_active
  on pg_certificate_bindings (tenant_id, service_instance_id, coalesce(domain_name, ''), keystore_path)
  where deleted_at is null and binding_type = 'KEYSTORE';
create unique index uq_pg_certificate_bindings_store_active
  on pg_certificate_bindings (tenant_id, service_instance_id, coalesce(domain_name, ''), store_location, store_name, coalesce(store_thumbprint, ''))
  where deleted_at is null and binding_type = 'WINDOWS_CERT_STORE';

