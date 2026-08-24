-- 006.3：把 CloudAccountAsset 作为插件能力的一等 Owner，并解除拓扑对象对 Host 的伪造依赖。
-- 历史迁移不可修改；本迁移只做向前兼容的约束和索引调整。

alter table plugin_capability_assignments
  drop constraint if exists plugin_capability_assignments_owner_type_check;

alter table plugin_capability_assignments
  add constraint plugin_capability_assignments_owner_type_check
  check (owner_type in ('DEVICE', 'MANAGED_TARGET', 'APPLICATION_ASSET', 'CLOUD_ACCOUNT_ASSET'));

alter table pg_framework_instances alter column device_id drop not null;
alter table pg_site_assets alter column device_id drop not null;
alter table pg_managed_targets alter column device_id drop not null;

alter table pg_framework_instances
  add constraint ck_pg_framework_instances_asset_owner
  check (asset_id is not null or device_id is not null);

alter table pg_site_assets
  add constraint ck_pg_site_assets_asset_owner
  check (asset_id is not null or device_id is not null);

alter table pg_managed_targets
  add constraint ck_pg_managed_targets_asset_owner
  check (asset_id is not null or device_id is not null);

drop index if exists uq_pg_framework_instances_identity;
create unique index uq_pg_framework_instances_identity
  on pg_framework_instances (
    tenant_id,
    coalesce(asset_id, ''),
    coalesce(device_id, ''),
    discovery_provider_key,
    framework_key
  ) where deleted_at is null;

drop index if exists uq_pg_site_assets_identity;
create unique index uq_pg_site_assets_identity
  on pg_site_assets (
    tenant_id,
    coalesce(asset_id, ''),
    coalesce(device_id, ''),
    discovery_provider_key,
    site_key
  ) where deleted_at is null;

drop index if exists uq_pg_managed_targets_identity;
create unique index uq_pg_managed_targets_identity
  on pg_managed_targets (
    tenant_id,
    coalesce(asset_id, ''),
    coalesce(device_id, ''),
    discovery_provider_key,
    target_type,
    target_key
  ) where deleted_at is null;

create index if not exists idx_plugin_capability_assignments_cloud_asset
  on plugin_capability_assignments (tenant_id, owner_id, capability_key, status)
  where owner_type = 'CLOUD_ACCOUNT_ASSET';
