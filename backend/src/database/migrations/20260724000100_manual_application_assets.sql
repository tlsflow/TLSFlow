update pg_certificate_bindings binding
set service_asset_id = null,
    updated_at = now(),
    version = version + 1
where binding.service_asset_id in (
  select asset.id
  from pg_service_assets asset
  join pg_application_asset_targets target
    on target.tenant_id = asset.tenant_id
   and target.application_asset_id = asset.id
   and target.deleted_at is null
  join pg_device_assets device
    on device.tenant_id = asset.tenant_id
   and device.service_asset_id = target.device_asset_id
  join pg_service_instances service
    on service.tenant_id = asset.tenant_id
   and service.id = asset.service_instance_id
  where asset.asset_kind = 'APPLICATION'
    and asset.discovery_source = 'PROVIDER'
    and asset.deleted_at is null
    and asset.metadata->>'deviceAssetId' = target.device_asset_id
    and target.metadata->>'deviceAssetId' = target.device_asset_id
    and device.device_family = 'NETSCALER_ADC'
    and service.provider_type = 'DEVICE_TEMPLATE'
    and service.service_name = 'netscaler-adc'
);

update pg_site_assets site
set service_asset_id = null,
    updated_at = now(),
    version = version + 1
where site.service_asset_id in (
  select asset.id
  from pg_service_assets asset
  join pg_application_asset_targets target
    on target.tenant_id = asset.tenant_id
   and target.application_asset_id = asset.id
   and target.deleted_at is null
  join pg_device_assets device
    on device.tenant_id = asset.tenant_id
   and device.service_asset_id = target.device_asset_id
  join pg_service_instances service
    on service.tenant_id = asset.tenant_id
   and service.id = asset.service_instance_id
  where asset.asset_kind = 'APPLICATION'
    and asset.discovery_source = 'PROVIDER'
    and asset.deleted_at is null
    and asset.metadata->>'deviceAssetId' = target.device_asset_id
    and target.metadata->>'deviceAssetId' = target.device_asset_id
    and device.device_family = 'NETSCALER_ADC'
    and service.provider_type = 'DEVICE_TEMPLATE'
    and service.service_name = 'netscaler-adc'
);

update pg_managed_targets managed
set service_asset_id = null,
    updated_at = now(),
    version = version + 1
where managed.service_asset_id in (
  select asset.id
  from pg_service_assets asset
  join pg_application_asset_targets target
    on target.tenant_id = asset.tenant_id
   and target.application_asset_id = asset.id
   and target.deleted_at is null
  join pg_device_assets device
    on device.tenant_id = asset.tenant_id
   and device.service_asset_id = target.device_asset_id
  join pg_service_instances service
    on service.tenant_id = asset.tenant_id
   and service.id = asset.service_instance_id
  where asset.asset_kind = 'APPLICATION'
    and asset.discovery_source = 'PROVIDER'
    and asset.deleted_at is null
    and asset.metadata->>'deviceAssetId' = target.device_asset_id
    and target.metadata->>'deviceAssetId' = target.device_asset_id
    and device.device_family = 'NETSCALER_ADC'
    and service.provider_type = 'DEVICE_TEMPLATE'
    and service.service_name = 'netscaler-adc'
);

update pg_application_asset_targets target
set status = 'DELETED',
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now(),
    version = version + 1
where target.deleted_at is null
  and target.application_asset_id in (
    select asset.id
    from pg_service_assets asset
    join pg_device_assets device
      on device.tenant_id = asset.tenant_id
     and device.service_asset_id = target.device_asset_id
    join pg_service_instances service
      on service.tenant_id = asset.tenant_id
     and service.id = asset.service_instance_id
    where asset.tenant_id = target.tenant_id
      and asset.asset_kind = 'APPLICATION'
      and asset.discovery_source = 'PROVIDER'
      and asset.deleted_at is null
      and asset.metadata->>'deviceAssetId' = target.device_asset_id
      and target.metadata->>'deviceAssetId' = target.device_asset_id
      and device.device_family = 'NETSCALER_ADC'
      and service.provider_type = 'DEVICE_TEMPLATE'
      and service.service_name = 'netscaler-adc'
  );

update pg_service_assets asset
set status = 'DELETED',
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now(),
    version = version + 1
where asset.asset_kind = 'APPLICATION'
  and asset.discovery_source = 'PROVIDER'
  and asset.deleted_at is null
  and exists (
    select 1
    from pg_application_asset_targets target
    join pg_device_assets device
      on device.tenant_id = target.tenant_id
     and device.service_asset_id = target.device_asset_id
    join pg_service_instances service
      on service.tenant_id = asset.tenant_id
     and service.id = asset.service_instance_id
    where target.tenant_id = asset.tenant_id
      and target.application_asset_id = asset.id
      and target.status = 'DELETED'
      and asset.metadata->>'deviceAssetId' = target.device_asset_id
      and target.metadata->>'deviceAssetId' = target.device_asset_id
      and device.device_family = 'NETSCALER_ADC'
      and service.provider_type = 'DEVICE_TEMPLATE'
      and service.service_name = 'netscaler-adc'
  );
