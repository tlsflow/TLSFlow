-- 迁移目的：创建企业 SSL 证书生命周期管理平台的核心数据模型。
-- 向后兼容：本迁移只创建新表、新索引和约束，不修改既有数据。
-- 回滚说明：开发初期可整库删除；生产环境必须按依赖反序 drop，不能在有业务数据时直接物理删除。
-- 设计原则：证书绑定 certificate_bindings 是生产事实中心，部署目标必须引用绑定。

-- PGlite 测试环境不支持 pgcrypto 扩展；PostgreSQL 13+ 可直接使用 gen_random_uuid()。

-- 租户是所有业务数据的隔离根。005 会深化用户、RBAC 和租户策略。
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name varchar(128) not null,
  code varchar(64) not null,
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_tenants_code unique (code)
);

create table certificate_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name varchar(256) not null,
  primary_domain varchar(255) not null,
  domain_pattern varchar(255),
  source_type varchar(32) not null check (source_type in ('MANUAL', 'ACME', 'ENTERPRISE_CA', 'EXTERNAL_API', 'CERTD', 'ALLINSSL')),
  owner_team varchar(128),
  environment varchar(32),
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint ck_certificate_assets_primary_domain_lower check (primary_domain = lower(primary_domain))
);

create unique index uq_certificate_assets_active_domain_env
  on certificate_assets (tenant_id, primary_domain, coalesce(environment, ''))
  where deleted_at is null;

create table certificate_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  certificate_asset_id uuid not null references certificate_assets(id),
  version_no integer not null check (version_no > 0),
  format varchar(32) not null check (format in ('PEM', 'PFX', 'JKS', 'DER', 'P7B')),
  common_name varchar(255),
  sans jsonb not null default '[]'::jsonb,
  issuer varchar(512),
  subject varchar(512),
  serial_number varchar(128) not null,
  fingerprint_sha256 char(64) not null,
  not_before timestamptz not null,
  not_after timestamptz not null,
  has_private_key boolean not null default false,
  private_key_secret_ref varchar(256),
  cert_secret_ref varchar(256) not null,
  chain_secret_ref varchar(256),
  import_batch_id uuid,
  status varchar(32) not null check (status in ('VALID', 'EXPIRED', 'REVOKED', 'MALFORMED', 'ARCHIVED')),
  parse_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_certificate_versions_asset_version unique (tenant_id, certificate_asset_id, version_no),
  constraint uq_certificate_versions_fingerprint unique (tenant_id, fingerprint_sha256),
  constraint ck_certificate_versions_fingerprint_lower_hex check (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ck_certificate_versions_time_range check (not_after > not_before),
  constraint ck_certificate_versions_private_key_ref check ((has_private_key = false and private_key_secret_ref is null) or (has_private_key = true and private_key_secret_ref is not null))
);

-- 同一证书版本派生出的格式只保存引用，不存明文材料。
create table certificate_version_formats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  certificate_version_id uuid not null references certificate_versions(id),
  format varchar(32) not null check (format in ('PEM', 'PFX', 'JKS', 'DER', 'P7B')),
  artifact_ref varchar(256) not null,
  password_secret_ref varchar(256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_certificate_version_formats unique (tenant_id, certificate_version_id, format)
);

create table hosts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  hostname varchar(255) not null,
  display_name varchar(255),
  primary_ip inet,
  ip_addresses jsonb not null default '[]'::jsonb,
  os_type varchar(32) not null check (os_type in ('WINDOWS', 'LINUX', 'UNIX', 'NETWORK_DEVICE', 'UNKNOWN')),
  os_name varchar(128),
  os_version varchar(128),
  arch varchar(64),
  environment varchar(32),
  zone_id uuid,
  compatibility_level varchar(8) not null check (compatibility_level in ('L1', 'L2', 'L3', 'L4', 'L5')),
  management_mode varchar(32) not null check (management_mode in ('AGENT', 'LEGACY_AGENT', 'GATEWAY', 'AGENTLESS', 'SCRIPT_PACKAGE', 'MONITOR_ONLY')),
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'UNKNOWN', 'RETIRED')),
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0)
);

create unique index uq_hosts_active_hostname
  on hosts (tenant_id, hostname)
  where deleted_at is null;

create table service_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  host_id uuid not null references hosts(id),
  provider_type varchar(64) not null check (provider_type in ('NGINX', 'APACHE', 'TOMCAT', 'IIS', 'WINDOWS_CERT_STORE', 'CUSTOM', 'DEVICE_TEMPLATE')),
  service_name varchar(128),
  display_name varchar(255) not null,
  version_text varchar(128),
  install_path text,
  config_path text,
  runtime_user varchar(128),
  discovery_source varchar(32) not null check (discovery_source in ('AGENT', 'SSH', 'MANUAL', 'GATEWAY')),
  last_discovered_at timestamptz,
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'STALE', 'UNREACHABLE', 'RETIRED')),
  raw_facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0)
);

create table service_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  service_instance_id uuid not null references service_instances(id),
  protocol varchar(16) not null check (protocol in ('HTTPS', 'TLS', 'STARTTLS', 'HTTP')),
  host_name varchar(255),
  listen_ip inet,
  port integer not null check (port between 1 and 65535),
  path_hint text,
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'UNKNOWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0)
);

create table certificate_bindings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  service_instance_id uuid not null references service_instances(id),
  service_endpoint_id uuid references service_endpoints(id),
  domain_name varchar(255),
  binding_type varchar(32) not null check (binding_type in ('FILE_PATH', 'WINDOWS_CERT_STORE', 'KEYSTORE', 'DEVICE_API', 'CUSTOM')),
  certificate_version_id uuid references certificate_versions(id),
  observed_fingerprint_sha256 char(64),
  desired_fingerprint_sha256 char(64),
  cert_path text,
  key_path text,
  chain_path text,
  keystore_path text,
  keystore_type varchar(32) check (keystore_type is null or keystore_type in ('JKS', 'PKCS12')),
  store_location varchar(64),
  store_name varchar(64),
  store_thumbprint varchar(128),
  reload_command text,
  verify_method varchar(32) not null check (verify_method in ('TLS_CONNECT', 'LOCAL_FILE', 'STORE_QUERY', 'CUSTOM')),
  last_verified_at timestamptz,
  last_deployed_at timestamptz,
  status varchar(32) not null default 'DISCOVERED' check (status in ('DISCOVERED', 'MANAGED', 'DRIFTED', 'EXPIRED', 'ERROR', 'IGNORED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint ck_certificate_bindings_domain_lower check (domain_name is null or domain_name = lower(domain_name)),
  constraint ck_certificate_bindings_observed_fp check (observed_fingerprint_sha256 is null or observed_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ck_certificate_bindings_desired_fp check (desired_fingerprint_sha256 is null or desired_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ck_certificate_bindings_location check (
    (binding_type = 'FILE_PATH' and cert_path is not null)
    or (binding_type = 'KEYSTORE' and keystore_path is not null)
    or (binding_type = 'WINDOWS_CERT_STORE' and store_location is not null and store_name is not null)
    or (binding_type in ('DEVICE_API', 'CUSTOM'))
  )
);

-- 文件路径型绑定的常见唯一性。复杂设备 API 绑定交给应用层按 metadata 做幂等判断。
create unique index uq_certificate_bindings_file_active
  on certificate_bindings (tenant_id, service_instance_id, coalesce(domain_name, ''), cert_path)
  where deleted_at is null and binding_type = 'FILE_PATH';
create unique index uq_certificate_bindings_keystore_active
  on certificate_bindings (tenant_id, service_instance_id, coalesce(domain_name, ''), keystore_path)
  where deleted_at is null and binding_type = 'KEYSTORE';
create unique index uq_certificate_bindings_store_active
  on certificate_bindings (tenant_id, service_instance_id, coalesce(domain_name, ''), store_location, store_name, coalesce(store_thumbprint, ''))
  where deleted_at is null and binding_type = 'WINDOWS_CERT_STORE';

create table target_capabilities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target_type varchar(32) not null check (target_type in ('HOST', 'AGENT', 'GATEWAY', 'EXECUTION_TARGET')),
  target_id uuid not null,
  capability_key varchar(128) not null,
  capability_value jsonb not null,
  source varchar(32) not null check (source in ('DETECTED', 'MANUAL', 'INHERITED', 'ASSUMED')),
  confidence integer not null check (confidence between 0 and 100),
  detected_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_target_capabilities_key unique (tenant_id, target_type, target_id, capability_key)
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  host_id uuid references hosts(id),
  agent_type varchar(32) not null check (agent_type in ('FULL', 'LEGACY', 'GATEWAY')),
  agent_version varchar(64) not null,
  install_id varchar(128) not null,
  status varchar(32) not null default 'UNKNOWN' check (status in ('ONLINE', 'OFFLINE', 'DISABLED', 'UPGRADING', 'UNKNOWN')),
  last_seen_at timestamptz,
  protocol_version varchar(32) not null,
  public_key_fingerprint varchar(128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_agents_install unique (tenant_id, install_id)
);

create table gateways (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  agent_id uuid not null references agents(id),
  zone_id uuid not null,
  name varchar(128) not null,
  status varchar(32) not null default 'OFFLINE' check (status in ('ONLINE', 'OFFLINE', 'DISABLED')),
  routing_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0)
);

create table execution_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target_kind varchar(32) not null check (target_kind in ('AGENT', 'GATEWAY_SSH', 'SSH', 'WINRM', 'SMB_WMI', 'CURL', 'SCRIPT_PACKAGE')),
  host_id uuid references hosts(id),
  agent_id uuid references agents(id),
  gateway_id uuid references gateways(id),
  endpoint varchar(512),
  credential_secret_ref varchar(256),
  status varchar(32) not null default 'UNKNOWN' check (status in ('ACTIVE', 'DISABLED', 'FAILED', 'UNKNOWN')),
  last_checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint ck_execution_targets_route check (host_id is not null or agent_id is not null or gateway_id is not null or endpoint is not null)
);

create table deployment_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name varchar(256) not null,
  plan_type varchar(32) not null check (plan_type in ('INSTALL', 'UPDATE', 'ROLLBACK', 'VERIFY_ONLY')),
  certificate_version_id uuid references certificate_versions(id),
  status varchar(32) not null check (status in ('DRAFT', 'PENDING_APPROVAL', 'READY', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED', 'ROLLED_BACK')),
  approval_status varchar(32) not null default 'NOT_REQUIRED' check (approval_status in ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  scheduled_at timestamptz,
  created_reason varchar(64) not null check (created_reason in ('MANUAL', 'AUTO_RENEW', 'RISK_FIX', 'ROLLBACK')),
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0)
);

create table deployment_plan_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  deployment_plan_id uuid not null references deployment_plans(id),
  certificate_binding_id uuid not null references certificate_bindings(id),
  execution_target_id uuid references execution_targets(id),
  required_capabilities jsonb not null default '[]'::jsonb,
  match_result jsonb,
  status varchar(32) not null default 'PENDING' check (status in ('PENDING', 'READY', 'SKIPPED', 'FAILED', 'COMPLETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_deployment_plan_targets_binding unique (tenant_id, deployment_plan_id, certificate_binding_id)
);

create table execution_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  deployment_plan_id uuid not null references deployment_plans(id),
  execution_target_id uuid references execution_targets(id),
  run_no integer not null check (run_no > 0),
  idempotency_key varchar(128) not null,
  external_run_id varchar(128),
  status varchar(32) not null check (status in ('PENDING', 'DISPATCHED', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_RUNNING', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED')),
  started_at timestamptz,
  finished_at timestamptz,
  error_code varchar(64),
  error_message text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_execution_runs_plan_run unique (tenant_id, deployment_plan_id, run_no),
  constraint uq_execution_runs_idempotency unique (tenant_id, idempotency_key),
  constraint uq_execution_runs_external unique (tenant_id, external_run_id)
);

create table execution_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  execution_run_id uuid not null references execution_runs(id),
  step_no integer not null check (step_no > 0),
  step_type varchar(64) not null check (step_type in ('DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY', 'ROLLBACK', 'CUSTOM')),
  name varchar(128) not null,
  input_snapshot jsonb,
  status varchar(32) not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED', 'TIMEOUT')),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_execution_steps_run_step unique (tenant_id, execution_run_id, step_no)
);

create table step_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  execution_step_id uuid not null references execution_steps(id),
  result_type varchar(32) not null check (result_type in ('LOG', 'OUTPUT', 'ASSERTION', 'FILE', 'METRIC')),
  result_data jsonb not null,
  created_at timestamptz not null default now()
);

create table backup_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  execution_run_id uuid not null references execution_runs(id),
  certificate_binding_id uuid not null references certificate_bindings(id),
  artifact_type varchar(32) not null check (artifact_type in ('FILE', 'CERT_STORE', 'KEYSTORE', 'CONFIG', 'DEVICE_CONFIG')),
  artifact_ref varchar(256) not null,
  checksum_sha256 char(64),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint ck_backup_artifacts_checksum check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$')
);

create table rollback_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  execution_run_id uuid not null references execution_runs(id),
  status varchar(32) not null default 'AVAILABLE' check (status in ('AVAILABLE', 'USED', 'EXPIRED', 'FAILED')),
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint uq_rollback_plans_run unique (tenant_id, execution_run_id)
);

create table plugin_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  name varchar(128) not null,
  plugin_version varchar(64) not null,
  package_ref varchar(256) not null,
  signature text,
  permissions jsonb not null default '[]'::jsonb,
  status varchar(32) not null default 'INSTALLED' check (status in ('INSTALLED', 'DISABLED', 'FAILED', 'UNINSTALLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_plugin_packages_name_version unique (tenant_id, name, plugin_version)
);

create table provider_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  plugin_package_id uuid references plugin_packages(id),
  provider_type varchar(64) not null,
  name varchar(128) not null,
  provider_version varchar(64) not null,
  capability_schema jsonb not null default '{}'::jsonb,
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED', 'DEPRECATED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint uq_provider_registry_type unique (tenant_id, provider_type, provider_version)
);

create table workflow_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  template_type varchar(32) not null check (template_type in ('CURL', 'SSH', 'HYBRID')),
  name varchar(128) not null,
  vendor varchar(128),
  device_type varchar(128),
  dsl_version varchar(32) not null,
  definition jsonb not null,
  status varchar(32) not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0)
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  workflow_template_id uuid not null references workflow_templates(id),
  execution_run_id uuid references execution_runs(id),
  status varchar(32) not null check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
  input_snapshot jsonb,
  output_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0)
);

create table monitor_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  service_endpoint_id uuid references service_endpoints(id),
  certificate_binding_id uuid references certificate_bindings(id),
  target_url varchar(512),
  sni varchar(255),
  check_type varchar(32) not null check (check_type in ('HTTPS', 'TCP_TLS', 'LOCAL', 'STORE', 'CUSTOM')),
  interval_seconds integer not null check (interval_seconds > 0),
  status varchar(32) not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint ck_monitor_targets_anchor check (service_endpoint_id is not null or certificate_binding_id is not null or target_url is not null)
);

create table certificate_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  monitor_target_id uuid not null references monitor_targets(id),
  observed_at timestamptz not null default now(),
  fingerprint_sha256 char(64),
  not_after timestamptz,
  chain_valid boolean,
  hostname_valid boolean,
  raw_result jsonb not null default '{}'::jsonb,
  constraint ck_certificate_observations_fp check (fingerprint_sha256 is null or fingerprint_sha256 ~ '^[0-9a-f]{64}$')
);

create table risk_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  risk_type varchar(64) not null check (risk_type in ('EXPIRING', 'EXPIRED', 'DRIFTED', 'CHAIN_INVALID', 'DEPLOY_FAILED', 'AGENT_OFFLINE')),
  severity varchar(16) not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  certificate_binding_id uuid references certificate_bindings(id),
  certificate_version_id uuid references certificate_versions(id),
  status varchar(32) not null default 'OPEN' check (status in ('OPEN', 'ACKED', 'RESOLVED', 'IGNORED')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  version integer not null default 1 check (version > 0),
  constraint ck_risk_events_anchor check (certificate_binding_id is not null or certificate_version_id is not null)
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  actor_type varchar(32) not null check (actor_type in ('USER', 'SYSTEM', 'AGENT', 'PLUGIN')),
  actor_id uuid,
  action varchar(128) not null,
  resource_type varchar(64) not null,
  resource_id uuid,
  request_id varchar(128),
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now()
);

-- 通用查询索引。别给所有 JSONB 乱建 GIN，主查询条件必须提升成普通列。
create index idx_tenants_status on tenants (status);
create index idx_certificate_assets_tenant_status on certificate_assets (tenant_id, status);
create index idx_certificate_assets_domain on certificate_assets (tenant_id, primary_domain, environment);
create index idx_certificate_versions_not_after on certificate_versions (tenant_id, not_after);
create index idx_certificate_versions_status on certificate_versions (tenant_id, status);
create index idx_certificate_versions_issuer_serial on certificate_versions (tenant_id, issuer, serial_number);
create index idx_hosts_hostname on hosts (tenant_id, hostname);
create index idx_hosts_primary_ip on hosts (tenant_id, primary_ip);
create index idx_hosts_status on hosts (tenant_id, status);
create index idx_hosts_compatibility on hosts (tenant_id, compatibility_level, management_mode);
create index idx_service_instances_host_provider on service_instances (tenant_id, host_id, provider_type);
create index idx_service_instances_status on service_instances (tenant_id, status);
create index idx_service_endpoints_host_port on service_endpoints (tenant_id, host_name, port);
create index idx_certificate_bindings_domain on certificate_bindings (tenant_id, domain_name);
create index idx_certificate_bindings_observed_fp on certificate_bindings (tenant_id, observed_fingerprint_sha256);
create index idx_certificate_bindings_desired_fp on certificate_bindings (tenant_id, desired_fingerprint_sha256);
create index idx_certificate_bindings_status_verified on certificate_bindings (tenant_id, status, last_verified_at);
create index idx_target_capabilities_lookup on target_capabilities (tenant_id, target_type, target_id, capability_key);
create index idx_agents_status_seen on agents (tenant_id, status, last_seen_at);
create index idx_gateways_status on gateways (tenant_id, status);
create index idx_execution_targets_kind_status on execution_targets (tenant_id, target_kind, status);
create index idx_deployment_plans_status_schedule on deployment_plans (tenant_id, status, scheduled_at);
create index idx_deployment_plan_targets_binding on deployment_plan_targets (tenant_id, certificate_binding_id);
create index idx_execution_runs_status on execution_runs (tenant_id, status, created_at desc);
create index idx_execution_steps_status on execution_steps (tenant_id, execution_run_id, status);
create index idx_step_results_step_created on step_results (tenant_id, execution_step_id, created_at);
create index idx_backup_artifacts_binding on backup_artifacts (tenant_id, certificate_binding_id);
create index idx_plugin_packages_status on plugin_packages (tenant_id, status);
create index idx_provider_registry_status on provider_registry (tenant_id, provider_type, status);
create index idx_workflow_templates_type_status on workflow_templates (tenant_id, template_type, status);
create index idx_workflow_runs_status on workflow_runs (tenant_id, status, created_at desc);
create index idx_monitor_targets_status on monitor_targets (tenant_id, status);
create index idx_certificate_observations_time on certificate_observations (tenant_id, observed_at desc);
create index idx_certificate_observations_fp on certificate_observations (tenant_id, fingerprint_sha256);
create index idx_risk_events_view on risk_events (tenant_id, status, severity, detected_at desc);
create index idx_audit_events_resource on audit_events (tenant_id, resource_type, resource_id, created_at desc);
create index idx_audit_events_request on audit_events (tenant_id, request_id);
