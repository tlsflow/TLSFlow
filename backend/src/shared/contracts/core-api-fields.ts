// 数据库 snake_case 到 API camelCase 的共享映射。Controller 不能直接暴露数据库行。
export const coreFieldMap = {
  id: 'id',
  tenant_id: 'tenantId',
  certificate_asset_id: 'certificateAssetId',
  certificate_version_id: 'certificateVersionId',
  service_instance_id: 'serviceInstanceId',
  service_endpoint_id: 'serviceEndpointId',
  certificate_binding_id: 'certificateBindingId',
  deployment_plan_id: 'deploymentPlanId',
  execution_target_id: 'executionTargetId',
  execution_run_id: 'executionRunId',
  execution_step_id: 'executionStepId',
  workflow_template_id: 'workflowTemplateId',
  monitor_target_id: 'monitorTargetId',
  fingerprint_sha256: 'fingerprintSha256',
  observed_fingerprint_sha256: 'observedFingerprintSha256',
  desired_fingerprint_sha256: 'desiredFingerprintSha256',
  not_before: 'notBefore',
  not_after: 'notAfter',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  deleted_at: 'deletedAt',
  created_by: 'createdBy',
  updated_by: 'updatedBy',
  last_seen_at: 'lastSeenAt',
  last_verified_at: 'lastVerifiedAt',
  last_deployed_at: 'lastDeployedAt',
  started_at: 'startedAt',
  finished_at: 'finishedAt',
  detected_at: 'detectedAt',
  resolved_at: 'resolvedAt'
} as const;

export type DatabaseFieldName = keyof typeof coreFieldMap;
export type ApiFieldName = (typeof coreFieldMap)[DatabaseFieldName];
