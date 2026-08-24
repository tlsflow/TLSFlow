-- 将旧 WORKFLOW 策略中的工作流执行配置迁入独立 Binding。
insert into workflow_execution_bindings (
  id,tenant_id,workflow_template_id,workflow_version_selection,workflow_version_id,runner,gateway_id,
  connection_bindings,variable_bindings,credential_bindings,certificate_artifact_bindings,status,version,created_at,updated_at
)
select
  'wfeb_migrated_' || asset.id,
  asset.tenant_id,
  asset.metadata->'deploymentStrategy'->'workflow'->>'workflowId',
  coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowVersionSelection', case when asset.metadata->'deploymentStrategy'->'workflow' ? 'workflowVersionId' then 'PINNED' else 'LATEST_PUBLISHED' end),
  case when coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowVersionSelection', case when asset.metadata->'deploymentStrategy'->'workflow' ? 'workflowVersionId' then 'PINNED' else 'LATEST_PUBLISHED' end)='PINNED'
    then asset.metadata->'deploymentStrategy'->'workflow'->>'workflowVersionId' else null end,
  coalesce(asset.metadata->'deploymentStrategy'->'workflow'->>'runner','CONTROL_PLANE'),
  asset.metadata->'deploymentStrategy'->'workflow'->>'gatewayId',
  coalesce(binding.connection_bindings, asset.metadata->'deploymentStrategy'->'workflow'->'connectionBindings', '{}'::jsonb),
  coalesce(binding.variable_bindings, asset.metadata->'deploymentStrategy'->'workflow'->'variableBindings', asset.metadata->'deploymentStrategy'->'workflow'->'parameterBindings', '{}'::jsonb),
  coalesce(binding.credential_bindings, asset.metadata->'deploymentStrategy'->'workflow'->'credentialBindings', '{}'::jsonb),
  coalesce(binding.certificate_artifact_bindings, asset.metadata->'deploymentStrategy'->'workflow'->'certificateArtifactBindings', '{}'::jsonb),
  'ACTIVE',1,now(),now()
from pg_service_assets asset
left join unified_plugin_bindings binding on binding.id=asset.metadata->'deploymentStrategy'->'workflow'->>'pluginBindingId'
where asset.deleted_at is null
  and asset.metadata->'deploymentStrategy'->>'type'='WORKFLOW'
  and nullif(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowId','') is not null
on conflict (id) do nothing;

-- 有受管关系的旧 WORKFLOW 迁为覆盖模式；没有关系的保持 standalone WORKFLOW。
update pg_service_assets asset
set metadata=jsonb_set(
      asset.metadata,
      '{deploymentStrategy}',
      case when relation.managed_target_id is not null then
        jsonb_build_object(
          'type','MANAGED_TARGET',
          'managedTarget',jsonb_strip_nulls(jsonb_build_object(
            'managedTargetId',relation.managed_target_id,
            'certificateFormatId',asset.metadata->'deploymentStrategy'->'managedTarget'->>'certificateFormatId',
            'executionMode','WORKFLOW_OVERRIDE',
            'workflowExecutionBindingId','wfeb_migrated_' || asset.id
          )),
          'compatibilityMode','UNIFIED',
          'updatedAt',now()
        )
      else
        jsonb_build_object(
          'type','WORKFLOW',
          'workflow',jsonb_build_object('workflowExecutionBindingId','wfeb_migrated_' || asset.id),
          'compatibilityMode','UNIFIED',
          'updatedAt',now()
        )
      end,
      true
    ),
    updated_at=now(),version=asset.version+1
from pg_application_asset_targets relation
where relation.tenant_id=asset.tenant_id and relation.application_asset_id=asset.id and relation.status='ACTIVE'
  and asset.deleted_at is null and asset.metadata->'deploymentStrategy'->>'type'='WORKFLOW';

-- PostgreSQL lateral 在没有关系时不返回行，补迁纯 standalone 记录。
update pg_service_assets asset
set metadata=jsonb_set(asset.metadata,'{deploymentStrategy}',jsonb_build_object(
      'type','WORKFLOW','workflow',jsonb_build_object('workflowExecutionBindingId','wfeb_migrated_' || asset.id),
      'compatibilityMode','UNIFIED','updatedAt',now()
    ),true),updated_at=now(),version=asset.version+1
where asset.deleted_at is null
  and asset.metadata->'deploymentStrategy'->>'type'='WORKFLOW'
  and exists (select 1 from workflow_execution_bindings binding where binding.id='wfeb_migrated_' || asset.id)
  and not exists (select 1 from pg_application_asset_targets target where target.tenant_id=asset.tenant_id and target.application_asset_id=asset.id and target.status='ACTIVE');

update plugin_capability_assignments assignment
set status='DISABLED',updated_at=now()
where assignment.owner_type='APPLICATION_ASSET' and assignment.status='ACTIVE'
  and exists (select 1 from pg_service_assets asset where asset.tenant_id=assignment.tenant_id and asset.id=assignment.owner_id and asset.metadata->'deploymentStrategy'->>'type'='WORKFLOW');

update unified_plugin_bindings binding
set status='DISABLED',updated_at=now(),version=version+1
where binding.mode='STANDALONE' and binding.status='ACTIVE'
  and not exists (select 1 from plugin_capability_assignments assignment where assignment.plugin_binding_id=binding.id and assignment.status='ACTIVE');

update pg_service_assets asset
set metadata=jsonb_set(asset.metadata,'{deploymentStrategy,managedTarget,executionMode}',to_jsonb('PLUGIN'::text),true),updated_at=now(),version=version+1
where asset.deleted_at is null and asset.metadata->'deploymentStrategy'->>'type'='MANAGED_TARGET'
  and coalesce(asset.metadata->'deploymentStrategy'->'managedTarget'->>'executionMode','')='';

update pg_documents set payload=jsonb_set(payload,'{origin}',to_jsonb('plugin_internal'::text),true),updated_at=now()
where namespace='workflow.templates' and payload->>'origin'='plugin';
