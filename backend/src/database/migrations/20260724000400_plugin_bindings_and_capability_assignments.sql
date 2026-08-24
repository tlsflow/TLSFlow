create table if not exists unified_plugin_bindings (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  plugin_version_id varchar(128) not null references unified_plugin_versions(id),
  mode varchar(32) not null check (mode in ('MANAGED', 'STANDALONE')),
  variable_bindings jsonb not null default '{}'::jsonb,
  secret_bindings jsonb not null default '{}'::jsonb,
  certificate_artifact_bindings jsonb not null default '{}'::jsonb,
  connection_bindings jsonb not null default '{}'::jsonb,
  managed_context jsonb,
  status varchar(32) not null check (status in ('ACTIVE', 'DISABLED', 'MIGRATING', 'ERROR')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_unified_plugin_bindings_tenant_status
  on unified_plugin_bindings (tenant_id, status, plugin_version_id);

create table if not exists plugin_capability_assignments (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  owner_type varchar(32) not null check (owner_type in ('DEVICE', 'MANAGED_TARGET', 'APPLICATION_ASSET')),
  owner_id varchar(128) not null,
  capability_key varchar(192) not null,
  plugin_version_id varchar(128) not null references unified_plugin_versions(id),
  plugin_binding_id varchar(128) not null references unified_plugin_bindings(id),
  precedence varchar(32) not null check (precedence in ('DEVICE_DEFAULT', 'TARGET_OVERRIDE', 'ASSET_OVERRIDE')),
  status varchar(32) not null check (status in ('ACTIVE', 'DISABLED', 'MIGRATING')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_plugin_capability_assignment unique (tenant_id, owner_type, owner_id, capability_key)
);

create index if not exists idx_plugin_capability_assignments_resolve
  on plugin_capability_assignments (tenant_id, capability_key, status, owner_type, owner_id);
