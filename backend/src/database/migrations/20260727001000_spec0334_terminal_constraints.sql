alter table pg_framework_instances
  alter column framework_type set not null;

alter table pg_managed_targets
  alter column supported_capabilities set not null,
  alter column execution_locations set not null;

alter table pg_managed_targets
  add constraint ck_pg_managed_targets_supported_capabilities_array
    check (jsonb_typeof(supported_capabilities)='array' and jsonb_array_length(supported_capabilities)>0),
  add constraint ck_pg_managed_targets_execution_locations_array
    check (jsonb_typeof(execution_locations)='array' and jsonb_array_length(execution_locations)>0),
  add constraint ck_pg_managed_targets_target_type_namespace
    check (target_type ~ '^[a-z0-9]+([.-][a-z0-9]+)+$');

alter table pg_site_assets
  add constraint ck_pg_site_assets_site_type_namespace
    check (site_type ~ '^[a-z0-9]+([.-][a-z0-9]+)+$');

alter table pg_framework_instances
  add constraint ck_pg_framework_instances_type_namespace
    check (framework_type ~ '^[a-z0-9]+([.-][a-z0-9]+)+$');
