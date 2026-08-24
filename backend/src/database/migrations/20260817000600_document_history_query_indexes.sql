-- PgDocumentRepository 的 predicate 仅适合小规模元数据；以下索引服务于已下沉 SQL 的持续增长历史路径。
create index if not exists idx_pg_documents_agent_tasks_idempotency
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'agentId'), (payload->>'idempotencyKey'), (payload->>'createdAt'))
  where namespace = 'agents:tasks';

create index if not exists idx_pg_documents_agent_task_logs_by_task
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'taskId'), (payload->>'emittedAt'), (payload->>'sequence'))
  where namespace = 'agents:taskLogs';

create index if not exists idx_pg_documents_execution_runs_plan_created
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'deploymentPlanId'), (payload->>'createdAt'))
  where namespace = 'executions:runs';

create index if not exists idx_pg_documents_execution_runs_idempotency
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'idempotencyKey'), (payload->>'createdAt'))
  where namespace = 'executions:runs';

create index if not exists idx_pg_documents_execution_steps_run_order
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'executionRunId'), ((payload->>'stepNo')::integer), (payload->>'createdAt'))
  where namespace = 'executions:steps';

create index if not exists idx_pg_documents_gateway_history_target
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'delegatedTargetId'), (payload->>'createdAt'))
  where namespace = 'gateway-target-history';

create index if not exists idx_pg_documents_gateway_history_task
  on pg_documents (namespace, (payload->>'taskId'), (payload->>'createdAt'))
  where namespace = 'gateway-target-history';

create index if not exists idx_pg_documents_deployment_plans_tenant_updated
  on pg_documents (namespace, (payload->>'tenantId'), updated_at)
  where namespace = 'deployment-plans:plans';

create index if not exists idx_pg_documents_deployment_plans_idempotency
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'createdBy'), (payload->>'idempotencyKey'), updated_at)
  where namespace = 'deployment-plans:plans';

create index if not exists idx_pg_documents_deployment_targets_plan
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'deploymentPlanId'), updated_at)
  where namespace = 'deployment-plans:targets';

create index if not exists idx_pg_documents_deployment_targets_asset
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'applicationAssetId'), (payload->>'deploymentPlanId'))
  where namespace = 'deployment-plans:targets';

create index if not exists idx_pg_documents_deployment_transitions_entity
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'entityId'), updated_at)
  where namespace = 'deployment-plans:transitions';
