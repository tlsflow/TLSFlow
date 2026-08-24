with projected_assets as (
  select distinct asset.tenant_id, asset.id
  from pg_service_assets asset
  join pg_application_asset_targets relation
    on relation.tenant_id = asset.tenant_id
   and relation.application_asset_id = asset.id
   and relation.deleted_at is null
  join pg_managed_targets target
    on target.tenant_id = relation.tenant_id
   and target.id = relation.managed_target_id
   and target.deleted_at is null
  join pg_framework_instances framework
    on framework.tenant_id = target.tenant_id
   and framework.id = target.framework_instance_id
   and framework.deleted_at is null
  where asset.asset_kind = 'APPLICATION'
    and asset.discovery_source = 'PROVIDER'
    and asset.deleted_at is null
    and framework.framework_type = 'adc.load-balancer'
)
update pg_certificate_bindings binding
set service_asset_id = null,
    updated_at = now(),
    version = version + 1
where exists (
  select 1
  from projected_assets projected
  where projected.tenant_id = binding.tenant_id
    and projected.id = binding.service_asset_id
);

with projected_assets as (
  select distinct asset.tenant_id, asset.id
  from pg_service_assets asset
  join pg_application_asset_targets relation
    on relation.tenant_id = asset.tenant_id
   and relation.application_asset_id = asset.id
   and relation.deleted_at is null
  join pg_managed_targets target
    on target.tenant_id = relation.tenant_id
   and target.id = relation.managed_target_id
   and target.deleted_at is null
  join pg_framework_instances framework
    on framework.tenant_id = target.tenant_id
   and framework.id = target.framework_instance_id
   and framework.deleted_at is null
  where asset.asset_kind = 'APPLICATION'
    and asset.discovery_source = 'PROVIDER'
    and asset.deleted_at is null
    and framework.framework_type = 'adc.load-balancer'
)
update pg_application_asset_targets relation
set status = 'DELETED',
    deleted_at = coalesce(relation.deleted_at, now()),
    updated_at = now(),
    version = version + 1
where relation.deleted_at is null
  and exists (
    select 1
    from projected_assets projected
    where projected.tenant_id = relation.tenant_id
      and projected.id = relation.application_asset_id
  );

update pg_service_assets asset
set status = 'DELETED',
    deleted_at = coalesce(asset.deleted_at, now()),
    updated_at = now(),
    version = version + 1
where asset.asset_kind = 'APPLICATION'
  and asset.discovery_source = 'PROVIDER'
  and asset.deleted_at is null
  and exists (
    select 1
    from pg_application_asset_targets relation
    join pg_managed_targets target
      on target.tenant_id = relation.tenant_id
     and target.id = relation.managed_target_id
     and target.deleted_at is null
    join pg_framework_instances framework
      on framework.tenant_id = target.tenant_id
     and framework.id = target.framework_instance_id
     and framework.deleted_at is null
    where relation.tenant_id = asset.tenant_id
      and relation.application_asset_id = asset.id
      and relation.status = 'DELETED'
      and framework.framework_type = 'adc.load-balancer'
  );
