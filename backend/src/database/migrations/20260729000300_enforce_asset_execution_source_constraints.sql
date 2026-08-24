do $$
begin
  if exists (
    select 1 from pg_service_assets asset
    where asset.deleted_at is null
      and asset.metadata->'deploymentStrategy'->>'type'='MANAGED_TARGET'
      and asset.metadata->'deploymentStrategy'->'managedTarget'->>'executionMode'='PLUGIN'
      and nullif(asset.metadata->'deploymentStrategy'->'managedTarget'->>'workflowExecutionBindingId','') is not null
  ) then raise exception 'PLUGIN strategy references WorkflowExecutionBinding'; end if;

  if exists (
    select 1 from pg_service_assets asset
    where asset.deleted_at is null
      and asset.metadata->'deploymentStrategy'->>'type'='WORKFLOW'
      and nullif(asset.metadata->'deploymentStrategy'->'workflow'->>'workflowExecutionBindingId','') is null
  ) then raise exception 'WORKFLOW strategy missing WorkflowExecutionBinding'; end if;

  if exists (
    select 1 from pg_service_assets asset
    join plugin_capability_assignments assignment on assignment.tenant_id=asset.tenant_id and assignment.owner_type='APPLICATION_ASSET' and assignment.owner_id=asset.id and assignment.status='ACTIVE'
    where asset.deleted_at is null and (
      asset.metadata->'deploymentStrategy'->>'type'='WORKFLOW' or
      asset.metadata->'deploymentStrategy'->'managedTarget'->>'executionMode'='WORKFLOW_OVERRIDE'
    )
  ) then raise exception 'workflow execution asset has ACTIVE plugin assignment'; end if;
end $$;

create index if not exists idx_service_assets_execution_mode
  on pg_service_assets ((metadata->'deploymentStrategy'->>'type'),(metadata->'deploymentStrategy'->'managedTarget'->>'executionMode'))
  where deleted_at is null;
