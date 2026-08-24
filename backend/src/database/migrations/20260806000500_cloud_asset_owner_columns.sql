-- 006.3：允许 Framework、Site、ManagedTarget 直接归属 CloudAccountAsset。
-- 旧 device_id 保持可读，云资源不再伪造 Host/Device。

alter table pg_framework_instances
  add column if not exists asset_id text;

alter table pg_site_assets
  add column if not exists asset_id text;

alter table pg_managed_targets
  add column if not exists asset_id text;

create index if not exists idx_pg_framework_instances_asset
  on pg_framework_instances (tenant_id, asset_id)
  where deleted_at is null;

create index if not exists idx_pg_site_assets_asset
  on pg_site_assets (tenant_id, asset_id)
  where deleted_at is null;

create index if not exists idx_pg_managed_targets_asset
  on pg_managed_targets (tenant_id, asset_id)
  where deleted_at is null;
