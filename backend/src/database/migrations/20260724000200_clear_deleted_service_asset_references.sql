update pg_certificate_bindings binding
set service_asset_id = null,
    updated_at = now(),
    version = version + 1
where binding.service_asset_id in (
  select asset.id
  from pg_service_assets asset
  where asset.deleted_at is not null
);

update pg_site_assets site
set service_asset_id = null,
    updated_at = now(),
    version = version + 1
where site.service_asset_id in (
  select asset.id
  from pg_service_assets asset
  where asset.deleted_at is not null
);

update pg_managed_targets managed
set service_asset_id = null,
    updated_at = now(),
    version = version + 1
where managed.service_asset_id in (
  select asset.id
  from pg_service_assets asset
  where asset.deleted_at is not null
);
