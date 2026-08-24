create table if not exists unified_plugin_workflow_bindings (
  plugin_version_id varchar(128) not null references unified_plugin_versions(id) on delete restrict,
  capability_key varchar(192) not null,
  workflow_resource_path varchar(512) not null,
  workflow_template_id varchar(128) not null,
  workflow_version_id varchar(128) not null,
  workflow_content_sha256 varchar(80) not null,
  created_at timestamptz not null,
  primary key (plugin_version_id, capability_key)
);

create index if not exists idx_unified_plugin_workflow_resource
  on unified_plugin_workflow_bindings (plugin_version_id, workflow_resource_path);

create index if not exists idx_unified_plugin_workflow_version
  on unified_plugin_workflow_bindings (workflow_version_id);
