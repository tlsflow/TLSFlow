-- Spec 033.2：统一 PluginBinding 成为部署变量、Secret、连接和证书产物的唯一事实源。

update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata,
      '{deploymentStrategy,workflow}',
      (((((asset.metadata->'deploymentStrategy'->'workflow')
        - 'parameterBindings')
        - 'variableBindings')
        - 'credentialRefs')
        - 'connectionBindings')
        - 'certificateArtifactBindings',
      true
    ),
    updated_at = now(),
    version = asset.version + 1
where asset.asset_kind = 'APPLICATION'
  and asset.deleted_at is null
  and asset.metadata->'deploymentStrategy'->>'type' = 'WORKFLOW'
  and coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'pluginBindingId', '') <> '';

update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata,
      '{deploymentStrategy,agent}',
      ((asset.metadata->'deploymentStrategy'->'agent')
        - 'certificateFormatId')
        - 'deploymentMode',
      true
    ),
    updated_at = now(),
    version = asset.version + 1
where asset.asset_kind = 'APPLICATION'
  and asset.deleted_at is null
  and asset.metadata->'deploymentStrategy'->>'type' = 'AGENT'
  and coalesce(asset.metadata->'deploymentStrategy'->'agent'->>'pluginBindingId', '') <> '';

update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata,
      '{deploymentStrategy,managedTarget}',
      ((asset.metadata->'deploymentStrategy'->'managedTarget')
        - 'certificateFormatId')
        - 'deploymentMode',
      true
    ),
    updated_at = now(),
    version = asset.version + 1
where asset.asset_kind = 'APPLICATION'
  and asset.deleted_at is null
  and asset.metadata->'deploymentStrategy'->>'type' = 'MANAGED_TARGET'
  and coalesce(asset.metadata->'deploymentStrategy'->'managedTarget'->>'pluginBindingId', '') <> '';
