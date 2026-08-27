export type AutomationStatus = 'draft' | 'active' | 'disabled' | 'deleted';
export type AutomationTriggerType = 'api' | 'once' | 'schedule' | 'on_demand' | 'certificate_version_created';
export type AutomationRunTriggerType = AutomationTriggerType | 'retry';
export type AutomationRunStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'partially_succeeded' | 'failed' | 'needs_attention' | 'stopped' | 'cancelled';
export type AutomationRunTargetStatus = 'pending' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type AutomationFailureStage = 'selection' | 'plan_creation' | 'dry_run' | 'approval' | 'execution' | 'verification' | 'rollback' | 'notification';
export type AutomationActionType = 'create_deployment_plan' | 'execute_deployment_plan' | 'send_notification';
export type AutomationTriggerDeliveryStatus = 'pending' | 'matched' | 'waiting_approval' | 'run_created' | 'skipped' | 'failed';
export type AutomationFilterOperator = 'eq' | 'neq' | 'in' | 'contains_any' | 'contains_all';
export type AutomationApprovalStageType = 'run';

export interface AutomationRunExecutionOptionsDto {
  stopOnError?: boolean;
  dryRun?: boolean;
}

export type AutomationTriggerDto =
  | { type: 'api' }
  | { type: 'once'; runAt: string }
  | { type: 'schedule'; cron: string; timeZone: string; startsAt?: string; endsAt?: string }
  | { type: 'on_demand' }
  // external_source 是历史配置别名，当前实际来源统一为手工导入或 ACME 自动续期。
  | { type: 'certificate_version_created'; sources?: Array<'external_source' | 'manual_import' | 'acme_issue'> };

export interface AutomationFilterClauseDto {
  field: string;
  operator: AutomationFilterOperator;
  value?: unknown;
}

export interface CreateDeploymentPlanActionConfigDto {
  workflowTemplateId?: string;
  certificateVersionId?: string;
  planType?: 'INSTALL' | 'UPDATE' | 'VERIFY_ONLY';
  selectionMode?: 'EXPLICIT' | 'LATEST_AUTO';
}

export interface ExecuteDeploymentPlanActionConfigDto {
  source: 'created_by_previous_action' | 'ready_plan';
  dryRunFirst?: boolean;
}

export interface SendNotificationActionConfigDto {
  templateKey: string;
  eventKey: string;
  routeId?: string;
  channelId?: string;
  events?: Array<'started' | 'completed' | 'failed' | 'waiting_approval'>;
}

export type AutomationActionDto =
  | { type: 'create_deployment_plan'; position: number; config: CreateDeploymentPlanActionConfigDto }
  | { type: 'execute_deployment_plan'; position: number; config: ExecuteDeploymentPlanActionConfigDto }
  | { type: 'send_notification'; position: number; config: SendNotificationActionConfigDto };

export interface AutomationMaintenanceWindowDto {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  timeZone: string;
}

export interface AutomationGuardrailsDto {
  maxTargetsPerRun: number;
  concurrencyLimit: number;
  requirePreview: boolean;
  requireDryRun: boolean;
  requireApproval: boolean;
  allowManualWhenDisabled?: boolean;
  allowedEnvironments?: string[];
  failureCountThreshold?: number;
  failureRateThreshold?: number;
  maintenanceWindow?: AutomationMaintenanceWindowDto;
}

export type AutomationTargetResolverDto =
  { type: 'certificate_version_targets'; assetIds?: string[] };

export interface AutomationApprovalStageDto {
  type: AutomationApprovalStageType;
  mode?: 'before_actions';
  operationType?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  expiresInHours?: number;
}

export interface AutomationConfigurationDto {
  trigger: AutomationTriggerDto;
  filters?: AutomationFilterClauseDto[];
  targetResolver: AutomationTargetResolverDto;
  approvalStage?: AutomationApprovalStageDto;
  actions: AutomationActionDto[];
  guardrails: AutomationGuardrailsDto;
}

export interface CreateAutomationInput extends AutomationConfigurationDto {
  name: string;
  description?: string;
}

export interface UpdateAutomationInput {
  expectedVersion: number;
  name?: string;
  description?: string;
  configuration?: AutomationConfigurationDto;
}

export interface AutomationDto {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: AutomationStatus;
  currentVersion: number;
  nextRunAt?: string;
  lastRunAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface AutomationVersionDto extends AutomationConfigurationDto {
  id: string;
  tenantId: string;
  automationId: string;
  version: number;
  checksum: string;
  createdBy: string;
  createdAt: string;
}

export interface AutomationTargetSummaryDto {
  total: number;
  pending: number;
  running: number;
  waitingApproval: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export interface AutomationRunDto {
  id: string;
  tenantId: string;
  automationId: string;
  automationVersion: number;
  automationNameSnapshot: string;
  triggerType: AutomationRunTriggerType;
  scheduledAt?: string;
  idempotencyKey: string;
  parentRunId?: string;
  triggerContext?: AutomationTriggerContextDto;
  executionOptions?: AutomationRunExecutionOptionsDto;
  approvalId?: string;
  deliveryId?: string;
  status: AutomationRunStatus;
  targetSummary: AutomationTargetSummaryDto;
  actionTypes: AutomationActionType[];
  environmentSnapshots: string[];
  failureStage?: AutomationFailureStage;
  failureCode?: string;
  failureMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface AutomationTargetSnapshotDto {
  certificateId: string;
  certificateName: string;
  certificateVersionId?: string;
  currentCertificateVersionId?: string;
  currentCertificateNotAfter?: string;
  targetCertificateNotAfter?: string;
  certificateVersionImpact?: 'upgrade' | 'same' | 'downgrade' | 'missing_current';
  eventId?: string;
  eventType?: string;
  sourceType?: string;
  bindingId?: string;
  assetId?: string;
  assetName?: string;
  environment?: string;
  ownerId?: string;
  tags: string[];
}

export interface AutomationRunTargetDto {
  id: string;
  tenantId: string;
  runId: string;
  sequenceNo: number;
  targetSnapshot: AutomationTargetSnapshotDto;
  environmentSnapshot?: string;
  actionTypes: AutomationActionType[];
  status: AutomationRunTargetStatus;
  currentAction?: AutomationActionType;
  failureStage?: AutomationFailureStage;
  deploymentPlanId?: string;
  executionRunId?: string;
  notificationRequestIds: string[];
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunActionResultDto {
  id: string;
  tenantId: string;
  runId: string;
  runTargetId?: string;
  actionType: AutomationActionType;
  actionPosition: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  externalReferenceType?: 'deployment_plan' | 'execution_run' | 'notification_request';
  externalReferenceId?: string;
  failureStage?: AutomationFailureStage;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface AutomationTriggerContextDto {
  deliveryId?: string;
  deliveryKey?: string;
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  sourceType?: string;
  certificateAssetId?: string;
  certificateVersionId?: string;
  domains?: string[];
  tags?: string[];
  totalMatched?: number;
  executableCount?: number;
  excludedCount?: number;
  excludedReasons?: Record<string, number>;
}

export interface AutomationTriggerDeliveryDto {
  id: string;
  tenantId: string;
  automationId: string;
  automationVersion: number;
  deliveryKey: string;
  triggerType: AutomationTriggerType;
  eventType?: string;
  payload: AutomationTriggerContextDto;
  status: AutomationTriggerDeliveryStatus;
  runId?: string;
  approvalId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationPreviewTargetDto {
  target: AutomationTargetSnapshotDto;
  executable: boolean;
  excludedReason?: 'permission_denied' | 'missing_version' | 'version_not_deployable' | 'binding_not_managed' | 'environment_not_allowed' | 'binding_missing' | 'asset_missing_deployment_capability' | 'certificate_version_downgrade' | 'certificate_already_up_to_date' | 'filter_not_matched' | 'runtime_context_required';
}

export interface AutomationPreviewDto {
  previewId: string;
  automationId: string;
  automationVersion: number;
  configurationChecksum: string;
  totalMatched: number;
  executableCount: number;
  excludedCount: number;
  excludedReasons: Record<string, number>;
  page: number;
  pageSize: number;
  items: AutomationPreviewTargetDto[];
  versionImpactSummary?: {
    total: number;
    upgrade: number;
    same: number;
    downgrade: number;
    missingCurrent: number;
  };
}
