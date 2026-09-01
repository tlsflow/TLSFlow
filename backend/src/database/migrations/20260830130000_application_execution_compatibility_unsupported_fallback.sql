-- 将无法回填稳定插件身份的历史工作流绑定物化为 UNSUPPORTED。
-- 保留 plugin_version_id 作为原始诊断线索；重复执行不得产生新的状态变更。
with affected_assets as (
  select
    asset.tenant_id,
    asset.id as application_asset_id,
    binding.id as binding_id,
    greatest(asset.version, binding.version) as reference_version,
    case
      when asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId' = binding.id
        then 'deploymentStrategy.workflow.workflowExecutionBindingId'
      else 'deploymentStrategy.managedTarget.workflowExecutionBindingId'
    end as reference_path
  from workflow_execution_bindings binding
  join pg_service_assets asset
    on asset.tenant_id = binding.tenant_id
   and asset.deleted_at is null
   and (
     asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId' = binding.id
     or asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId' = binding.id
   )
  where binding.plugin_id is null
)
insert into application_execution_compatibility (
  tenant_id,
  application_asset_id,
  source_type,
  source_id,
  status,
  issues,
  checked_plugin_version_id,
  checked_workflow_version_id,
  checked_at,
  reference_version,
  scan_generation,
  version
)
select
  affected.tenant_id,
  affected.application_asset_id,
  'WORKFLOW_EXECUTION_BINDING',
  affected.binding_id,
  'UNSUPPORTED',
  jsonb_build_array(jsonb_build_object(
    'code', 'APPLICATION_EXECUTION_REFERENCE_INVALID',
    'path', affected.reference_path,
    'category', 'REFERENCE'
  )),
  binding.plugin_version_id,
  binding.workflow_version_id,
  now(),
  affected.reference_version,
  0,
  1
from affected_assets affected
join workflow_execution_bindings binding
  on binding.tenant_id = affected.tenant_id
 and binding.id = affected.binding_id
on conflict (tenant_id, application_asset_id, source_type, source_id) do update set
  status = excluded.status,
  issues = excluded.issues,
  checked_plugin_version_id = excluded.checked_plugin_version_id,
  checked_workflow_version_id = excluded.checked_workflow_version_id,
  reference_version = excluded.reference_version,
  scan_generation = excluded.scan_generation
where (
  application_execution_compatibility.status is distinct from 'UNSUPPORTED'
  or application_execution_compatibility.issues is distinct from excluded.issues
  or application_execution_compatibility.checked_plugin_version_id is distinct from excluded.checked_plugin_version_id
  or application_execution_compatibility.checked_workflow_version_id is distinct from excluded.checked_workflow_version_id
  or application_execution_compatibility.reference_version is distinct from excluded.reference_version
)
and (
  application_execution_compatibility.scan_generation < excluded.scan_generation
  or (
    application_execution_compatibility.scan_generation = excluded.scan_generation
    and application_execution_compatibility.reference_version <= excluded.reference_version
  )
);
