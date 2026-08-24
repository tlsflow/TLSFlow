create table if not exists agent_plugin_mounts (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  agent_id varchar(128) not null,
  plugin_package_id varchar(128) not null,
  plugin_version_id varchar(128) not null,
  package_hash varchar(128) not null,
  status varchar(32) not null check (status in ('PENDING_SYNC', 'MOUNTED', 'INCOMPATIBLE', 'PENDING_APPROVAL', 'DISABLED')),
  compatibility_snapshot jsonb not null default '{}'::jsonb,
  permission_snapshot jsonb not null default '{}'::jsonb,
  mounted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_agent_plugin_mounts_agent_version unique (tenant_id, agent_id, plugin_version_id)
);

create index if not exists idx_agent_plugin_mounts_agent_status
  on agent_plugin_mounts (tenant_id, agent_id, status);
