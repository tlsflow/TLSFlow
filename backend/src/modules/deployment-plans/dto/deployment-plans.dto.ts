import type { DeploymentPlanStatus, ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { RiskLevel } from '../../../shared/security-types.js';
import type { ExecutionRunDto, ExecutionSourceDto } from '../../executions/dto/executions.dto.js';
import type { FallbackSuggestion, GatewayAdapterType } from '../../gateway-agents/gateway-agent.types.js';
import type { AgentSecurityStatus } from '../../agents/security/agent-security.contract.js';

export type DeploymentPlanType = 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY';
export type DeploymentPlanApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type DeploymentPlanTargetStatus = 'PENDING' | 'READY' | 'SKIPPED' | 'FAILED' | 'COMPLETED';
export type DeploymentPlanSelectionMode = 'EXPLICIT' | 'LATEST_AUTO';
export type DeploymentPlanWorkflowVersionSelection = 'FIXED';

export interface DeploymentPlanWorkflowIdentityDto {
  mode: 'WORKFLOW' | 'PLUGIN_INTERNAL_WORKFLOW';
  workflowId?: string;
  workflowName?: string;
  workflowVersionId: string;
  workflowDslVersion?: string;
  workflowVersionSelection: DeploymentPlanWorkflowVersionSelection;
  pluginId?: string;
  pluginVersion?: string;
  pluginVersionId?: string;
  capabilityKey?: string;
  packageSha256?: string;
  manifestSha256?: string;
  resourceSha256?: Record<string, string>;
  workflowContentSha256?: string;
  targetIds: string[];
}

export interface DeploymentPlanPolicyDto {
  approvalRequired?: boolean;
  riskLevel?: RiskLevel;
  failurePolicy?: 'stop' | 'continue' | 'rollback';
  batchSize?: number;
  retry?: { maxAttempts: number; backoffSeconds: number };
}

export interface DeploymentGatewayRouteCandidateDto {
  gatewayId: string;
  agentId?: string;
  zoneId?: string;
  adapter?: GatewayAdapterType;
  score?: number;
  reasons?: string[];
}

export interface DeploymentGatewayRouteDto {
  gatewayId?: string;
  agentId?: string;
  zoneId?: string;
  adapter?: GatewayAdapterType;
  delegatedTargetId?: string;
  candidateGateways?: DeploymentGatewayRouteCandidateDto[];
  fallbackSuggestions?: FallbackSuggestion[];
  missingCapabilities?: string[];
  blockedReason?: string;
  approvalRequired?: boolean;
  mockSafeLocalRuntime?: boolean;
}

export interface DeploymentPlanTargetDto {
  id: string;
  tenantId?: string;
  deploymentPlanId: string;
  certificateBindingId?: string;
  applicationAssetId?: string;
  serviceAssetId?: string;
  executionTargetId?: string;
  executorType: ExecutionTargetKind;
  requiredCapabilities: string[];
  matchResult?: Record<string, unknown>;
  gatewayRoute?: DeploymentGatewayRouteDto;
  strategyPayload?: Record<string, unknown>;
  status: DeploymentPlanTargetStatus;
  executionStatus?: AgentSecurityStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  version: number;
}

export interface DeploymentPlanApprovalDto {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'consumed';
  riskLevel: RiskLevel;
  requestedBy: string;
  approvedBy?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentPlanDto {
  id: string;
  tenantId?: string;
  name: string;
  planType: DeploymentPlanType;
  selectionMode: DeploymentPlanSelectionMode;
  certificateVersionId: string;
  certificateFormatId?: string;
  status: DeploymentPlanStatus;
  executionStatus?: AgentSecurityStatus;
  approvalStatus: DeploymentPlanApprovalStatus;
  approvalId?: string;
  approval?: DeploymentPlanApprovalDto;
  snapshotHash: string;
  idempotencyKey: string;
  policy: DeploymentPlanPolicyDto;
  createdReason: 'MANUAL' | 'AUTO_RENEW' | 'RISK_FIX' | 'ROLLBACK';
  temporary?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  version: number;
  targets: DeploymentPlanTargetDto[];
  workflowExecutionIdentities?: DeploymentPlanWorkflowIdentityDto[];
  latestRunId?: string;
  latestRun?: ExecutionRunDto;
}

export interface DeploymentPlanDryRunCheckDto {
  key: string;
  label: string;
  status: 'passed' | 'failed' | 'warning' | 'unknown';
  detail?: string;
  evidence?: Record<string, unknown>;
}

/**
 * 部署计划的同步只读预检结果。
 *
 * 该结果不对应 ExecutionRun：它只校验计划快照、证书、目标、输入和审批
 * 的当前一致性，绝不派发任务或调用任何远端执行器。
 */
export interface DeploymentPlanPreflightResultDto {
  plan: DeploymentPlanDto;
  checks: DeploymentPlanDryRunCheckDto[];
  summary: {
    passed: number;
    failed: number;
    warning: number;
    unknown: number;
  };
}

/**
 * 应用资产视角的部署记录。
 *
 * DeploymentPlan 仍是执行快照和审批边界；该 DTO 只把同一应用资产的
 * 运行、预检与回滚事实聚合给资产详情页，不改变计划或资产的数据模型。
 */
export interface ApplicationAssetDeploymentRecordDto extends DeploymentPlanDto {
  runs: ExecutionRunDto[];
  latestPreflight?: {
    run: ExecutionRunDto;
    checks: DeploymentPlanDryRunCheckDto[];
  };
  latestRollback?: ExecutionRunDto;
}

export interface CreateDeploymentPlanInput {
  name: string;
  certificateAssetId?: string;
  certificateVersionId?: string;
  certificateFormatId?: string;
  selectionMode?: DeploymentPlanSelectionMode;
  targets: Array<{
    certificateBindingId?: string;
    applicationAssetId?: string;
    serviceAssetId?: string;
    managedTargetId?: string;
    siteAssetId?: string;
    domain?: string;
    executionTargetId?: string;
    executorType?: ExecutionTargetKind;
    requiredCapabilities?: string[];
    matchResult?: Record<string, unknown>;
    gatewayRoute?: DeploymentGatewayRouteDto;
    gatewayId?: string;
    zoneId?: string;
    adapter?: GatewayAdapterType;
    protocols?: GatewayAdapterType[];
    action?: string;
    destructive?: boolean;
    delegatedTargetId?: string;
	    fallbackSuggestions?: FallbackSuggestion[];
	    strategyPayload?: Record<string, unknown>;
	  }>;
  planType?: DeploymentPlanType;
  policy?: DeploymentPlanPolicyDto;
  createdReason?: DeploymentPlanDto['createdReason'];
  temporary?: boolean;
  idempotencyKey: string;
  actorId: string;
  tenantId?: string;
}

export interface CreateDeploymentPlanFromApplicationAssetInput {
  applicationAssetId: string;
  certificateAssetId?: string;
  targetCertificateVersionId?: string;
  certificateFormatId?: string;
  selectionMode?: DeploymentPlanSelectionMode;
  planType?: DeploymentPlanType;
  policy?: DeploymentPlanPolicyDto;
  /**
   * 自动化创建时禁止复用用户手工草稿，避免不同运行共享可变计划。
   */
  reuseDraft?: boolean;
  /** 统一向导仅创建 DRAFT 资产与计划；证书域名和产物预检延迟到预检/提交/执行阶段。 */
  deferPreflight?: boolean;
  /**
   * 自动化内部使用的临时计划，执行完成后会被清理且不进入计划列表。
   */
  temporary?: boolean;
  idempotencyKey: string;
  actorId: string;
  tenantId?: string;
}

export interface UpdateDeploymentPlanFromApplicationAssetInput extends CreateDeploymentPlanFromApplicationAssetInput {
  planId: string;
  expectedVersion: number;
}

export interface SubmitDeploymentPlanInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  approvalId?: string;
  executionSource?: ExecutionSourceDto;
}

export interface ExecuteDeploymentPlanInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  idempotencyKey: string;
  approvalId?: string;
  executionSource?: ExecutionSourceDto;
}

export interface DryRunDeploymentPlanInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  /** 同步只读预检不创建任务，因此幂等键仅为旧调用方兼容字段。 */
  idempotencyKey?: string;
  executionSource?: ExecutionSourceDto;
}

export interface CancelDeploymentPlanInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  reason?: string;
}

export interface ReevaluateDeploymentPlanCapabilitiesInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  targetResults: Array<{
    targetId: string;
    matchResult: Record<string, unknown>;
  }>;
}
