create temporary table tmp_spec0334_all_target_replacements on commit drop as
select historical.tenant_id,
       historical.id as historical_target_id,
       replacement.id as active_target_id,
       replacement.site_id as active_site_id,
       replacement.framework_instance_id as active_framework_instance_id,
       replacement.device_id as active_device_id
from pg_managed_targets historical
join lateral (
  select active.*
  from pg_managed_targets active
  where active.tenant_id = historical.tenant_id
    and active.deleted_at is null
    and active.status = 'ACTIVE'
    and active.device_id = historical.device_id
    and active.framework_instance_id is not distinct from historical.framework_instance_id
    and active.target_type = historical.target_type
    and coalesce(active.binding_key, '') = coalesce(historical.binding_key, '')
  order by active.last_seen_at desc nulls last, active.updated_at desc, active.id
  limit 1
) replacement on true
where historical.id <> replacement.id;

update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata,
      '{deploymentStrategy,managedTarget,managedTargetId}',
      to_jsonb(replacement.active_target_id),
      true
    ),
    host_id = replacement.active_device_id,
    service_instance_id = replacement.active_framework_instance_id,
    updated_at = now(),
    version = asset.version + 1
from tmp_spec0334_all_target_replacements replacement
where asset.tenant_id = replacement.tenant_id
  and asset.deleted_at is null
  and asset.metadata #>> '{deploymentStrategy,managedTarget,managedTargetId}' = replacement.historical_target_id;

update pg_application_asset_targets relation
set managed_target_id = target.id,
    updated_at = now(),
    version = relation.version + 1
from pg_service_assets asset
join pg_managed_targets target
  on target.tenant_id = asset.tenant_id
 and target.id = asset.metadata #>> '{deploymentStrategy,managedTarget,managedTargetId}'
 and target.deleted_at is null
 and target.status = 'ACTIVE'
where relation.tenant_id = asset.tenant_id
  and relation.application_asset_id = asset.id
  and relation.deleted_at is null
  and relation.managed_target_id <> target.id;

update pg_certificate_bindings binding
set managed_target_id = relation.managed_target_id,
    site_asset_id = target.site_id,
    service_instance_id = target.framework_instance_id,
    updated_at = now(),
    version = binding.version + 1
from pg_application_asset_targets relation
join pg_managed_targets target
  on target.tenant_id = relation.tenant_id
 and target.id = relation.managed_target_id
 and target.deleted_at is null
 and target.status = 'ACTIVE'
where binding.tenant_id = relation.tenant_id
  and binding.service_asset_id = relation.application_asset_id
  and binding.deleted_at is null
  and relation.deleted_at is null;

update pg_managed_targets
set status = 'DELETED',
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now(),
    version = version + 1
where status = 'STALE';

update pg_site_assets
set status = 'DELETED',
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now(),
    version = version + 1
where status = 'STALE';
