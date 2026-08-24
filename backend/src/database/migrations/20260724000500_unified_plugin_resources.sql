create table if not exists unified_plugin_resources (
  plugin_version_id varchar(128) not null references unified_plugin_versions(id) on delete restrict,
  resource_path varchar(512) not null,
  resource_content text not null,
  resource_sha256 varchar(80) not null,
  created_at timestamptz not null,
  primary key (plugin_version_id, resource_path)
);

create index if not exists idx_unified_plugin_resources_version
  on unified_plugin_resources (plugin_version_id, resource_path);
