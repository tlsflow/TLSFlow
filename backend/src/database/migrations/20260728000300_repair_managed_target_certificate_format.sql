update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata - 'certificateFormatId',
      '{deploymentStrategy,managedTarget,certificateFormatId}',
      to_jsonb(asset.metadata->>'certificateFormatId'),
      true
    ),
    updated_at = now(),
    version = asset.version + 1
where asset.asset_kind = 'APPLICATION'
  and asset.deleted_at is null
  and asset.metadata #>> '{deploymentStrategy,type}' = 'MANAGED_TARGET'
  and coalesce(asset.metadata #>> '{deploymentStrategy,managedTarget,certificateFormatId}', '') = ''
  and coalesce(asset.metadata->>'certificateFormatId', '') <> '';
