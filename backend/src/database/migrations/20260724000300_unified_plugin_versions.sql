create table if not exists unified_plugin_versions (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  plugin_id varchar(192) not null,
  plugin_version varchar(64) not null,
  source varchar(32) not null check (source in ('BUILTIN', 'USER')),
  runtime varchar(32) not null check (runtime in ('AGENT_ATOMIC', 'WORKFLOW_DSL')),
  scope varchar(32) not null check (scope in ('MANAGED', 'STANDALONE', 'BOTH')),
  trust varchar(32) not null check (trust in ('OFFICIAL_SIGNED', 'USER_SIGNED', 'UNSIGNED')),
  support varchar(32) not null check (support in ('OFFICIAL', 'COMMUNITY', 'SELF_MANAGED')),
  manifest jsonb not null,
  package_sha256 varchar(80) not null,
  manifest_sha256 varchar(80) not null,
  resource_sha256 jsonb not null default '{}'::jsonb,
  status varchar(32) not null check (status in ('IMPORTED', 'PENDING_APPROVAL', 'DISABLED', 'ENABLED', 'RETIRED', 'QUARANTINED')),
  permission_approval_status varchar(32) not null check (permission_approval_status in ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  approved_permissions jsonb not null default '[]'::jsonb,
  validation_report jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_unified_plugin_versions_identity unique (tenant_id, plugin_id, plugin_version)
);

create index if not exists idx_unified_plugin_versions_catalog
  on unified_plugin_versions (tenant_id, status, runtime, source, plugin_id);
