import type { DeploymentPlanStatus, ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { RiskLevel } from '../../../shared/security-types.js';
import type { ExecutionRunDto } from '../../executions/dto/executions.dto.js';
import type { FallbackSuggestion, GatewayAdapterType } from '../../gateway-agents/gateway-agent.types.js';

export type DeploymentPlanType = 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY';
export type DeploymentPlanApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type DeploymentPlanTargetStatus = 'PENDING' | 'READY' | 'SKIPPED' | 'FAILED' | 'COMPLETED';
export type DeploymentPlanSelectionMode = 'EXPLICIT' | 'LATEST_AUTO';

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
  gatewayAgentId?: string;
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
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  version: number;
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
  approvalStatus: DeploymentPlanApprovalStatus;
  approvalId?: string;
  snapshotHash: string;
  idempotencyKey: string;
  policy: DeploymentPlanPolicyDto;
  createdReason: 'MANUAL' | 'AUTO_RENEW' | 'RISK_FIX' | 'ROLLBACK';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  version: number;
  targets: DeploymentPlanTargetDto[];
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

export interface CreateDeploymentPlanInput {
  name: string;
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
  idempotencyKey: string;
  actorId: string;
  tenantId?: string;
}

export interface CreateDeploymentPlanFromApplicationAssetInput {
  applicationAssetId: string;
  targetCertificateVersionId?: string;
  certificateFormatId?: string;
  selectionMode?: DeploymentPlanSelectionMode;
  planType?: DeploymentPlanType;
  policy?: DeploymentPlanPolicyDto;
  idempotencyKey: string;
  actorId: string;
  tenantId?: string;
}

export interface UpdateDeploymentPlanFromApplicationAssetInput extends CreateDeploymentPlanFromApplicationAssetInput {
  planId: string;
}

export interface SubmitDeploymentPlanInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  approvalId?: string;
}

export interface ExecuteDeploymentPlanInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  idempotencyKey: string;
  approvalId?: string;
}

export interface DryRunDeploymentPlanInput {
  planId: string;
  actorId: string;
  tenantId?: string;
  idempotencyKey: string;
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
