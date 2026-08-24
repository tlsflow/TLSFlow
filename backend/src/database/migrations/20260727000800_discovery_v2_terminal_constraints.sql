alter table pg_site_assets
  drop constraint if exists pg_site_assets_site_type_check;

alter table plugin_discovered_certificate_bindings
  alter column site_asset_id drop not null,
  add column if not exists managed_target_id text references pg_managed_targets(id);

drop index if exists uq_pg_service_instances_identity;
drop index if exists uq_pg_site_assets_identity;
drop index if exists uq_pg_managed_targets_identity;

create unique index uq_pg_framework_instances_identity
  on pg_framework_instances (tenant_id, device_id, discovery_provider_key, framework_key)
  where deleted_at is null;

create unique index uq_pg_site_assets_identity
  on pg_site_assets (tenant_id, device_id, discovery_provider_key, site_key)
  where deleted_at is null;

create unique index uq_pg_managed_targets_identity
  on pg_managed_targets (tenant_id, device_id, discovery_provider_key, target_type, target_key)
  where deleted_at is null;

create index idx_plugin_discovered_bindings_target
  on plugin_discovered_certificate_bindings (tenant_id, managed_target_id);
