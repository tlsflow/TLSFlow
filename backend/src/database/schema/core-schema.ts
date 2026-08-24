// 核心表名和关键关系元数据。这里不是 ORM，只是给测试、迁移和后续 Repository 共享稳定事实。
export const coreTableNames = [
  'tenants',
  'tenant_memberships',
  'certificate_assets',
  'certificate_versions',
  'certificate_version_formats',
  'hosts',
  'service_instances',
  'service_endpoints',
  'certificate_bindings',
  'target_capabilities',
  'agents',
  'gateways',
  'execution_targets',
  'deployment_plans',
  'deployment_plan_targets',
  'execution_runs',
  'execution_steps',
  'step_results',
  'backup_artifacts',
  'rollback_plans',
  'plugin_packages',
  'provider_registry',
  'workflow_templates',
  'workflow_runs',
  'monitor_targets',
  'certificate_observations',
  'risk_events',
  'audit_events'
] as const;

export type CoreTableName = (typeof coreTableNames)[number];

export const requiredCoreIndexes = [
  'uq_tenant_memberships_active_subject_tenant',
  'idx_tenant_memberships_subject_status',
  'idx_tenant_memberships_tenant_status',
  'uq_certificate_versions_fingerprint',
  'idx_certificate_versions_not_after',
  'idx_certificate_bindings_domain',
  'idx_certificate_bindings_observed_fp',
  'idx_certificate_bindings_status_verified',
  'idx_target_capabilities_lookup',
  'idx_deployment_plans_status_schedule',
  'uq_execution_runs_plan_run',
  'uq_execution_runs_idempotency',
  'uq_execution_steps_run_step',
  'idx_risk_events_view',
  'idx_audit_events_resource',
] as const;

export const coreForeignKeyEdges = [
  ['tenant_memberships', 'tenants'],
  ['certificate_versions', 'certificate_assets'],
  ['certificate_bindings', 'service_instances'],
  ['certificate_bindings', 'service_endpoints'],
  ['certificate_bindings', 'certificate_versions'],
  ['deployment_plan_targets', 'deployment_plans'],
  ['deployment_plan_targets', 'certificate_bindings'],
  ['execution_runs', 'deployment_plans'],
  ['execution_steps', 'execution_runs'],
  ['backup_artifacts', 'certificate_bindings'],
  ['workflow_runs', 'workflow_templates'],
  ['risk_events', 'certificate_bindings'],
  ['audit_events', 'tenants']
] as const;
