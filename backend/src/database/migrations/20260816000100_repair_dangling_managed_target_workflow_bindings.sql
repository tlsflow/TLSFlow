-- 清理受管目标策略中已经不存在的 WorkflowExecutionBinding 引用。
-- 插件模式会重新生成完整策略；历史孤儿引用必须回退为可解析的插件模式。

create temporary table gcac_dangling_managed_target_workflow_bindings (
  tenant_id text not null,
  service_asset_id text not null,
  workflow_execution_binding_id text not null,
  primary key (tenant_id, service_asset_id)
) on commit drop;

insert into gcac_dangling_managed_target_workflow_bindings (
  tenant_id, service_asset_id, workflow_execution_binding_id
)
select
  asset.tenant_id,
  asset.id,
  asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId'
from pg_service_assets asset
where asset.deleted_at is null
  and asset.metadata->'deploymentStrategy'->>'type' = 'MANAGED_TARGET'
  and nullif(asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId', '') is not null
  and not exists (
    select 1
    from workflow_execution_bindings binding
    where binding.tenant_id = asset.tenant_id
      and binding.id = asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId'
  );

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260816-MTA-' || md5(dangling.tenant_id || ':' || dangling.service_asset_id),
  '20260816000100',
  'pg_service_assets',
  '',
  dangling.service_asset_id,
  'UPDATE',
  'REMOVED_DANGLING_WORKFLOW_EXECUTION_BINDING_REFERENCE',
  jsonb_build_object(
    'tenantId', dangling.tenant_id,
    'workflowExecutionBindingId', dangling.workflow_execution_binding_id,
    'fallbackExecutionMode', 'PLUGIN'
  )
from gcac_dangling_managed_target_workflow_bindings dangling
on conflict do nothing;

update pg_service_assets asset
set metadata = jsonb_set(
      asset.metadata,
      ARRAY['deploymentStrategy', 'managedTarget']::text[],
      (((asset.metadata->'deploymentStrategy')->'managedTarget') - 'workflowExecutionBindingId'::text)
        || jsonb_build_object('executionMode', 'PLUGIN'),
      true
    ),
    updated_at = now(),
    version = asset.version + 1
from gcac_dangling_managed_target_workflow_bindings dangling
where dangling.tenant_id = asset.tenant_id
  and dangling.service_asset_id = asset.id;
