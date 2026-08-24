import type { DeploymentPlanStatus, ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { RiskLevel } from '../../../shared/security-types.js';
import type { FallbackSuggestion, GatewayAdapterType } from '../../gateway-agents/gateway-agent.types.js';

export type DeploymentPlanType = 'INSTALL' | 'UPDATE' | 'ROLLBACK' | 'VERIFY_ONLY';
export type DeploymentPlanApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type DeploymentPlanTargetStatus = 'PENDING' | 'READY' | 'SKIPPED' | 'FAILED' | 'COMPLETED';

export interface DeploymentPlanPolicyDto {
  approvalRequired?: boolean;
  riskLevel?: RiskLevel;
  failurePolicy?: 'stop' | 'continue' | 'rollback';
  batchSize?: number;
  retry?: { maxAttempts: number; backoffSeconds: number };
}

export interface DeploymentGatewayRouteDto {
  gatewayId?: string;
  zoneId?: string;
  adapter?: GatewayAdapterType;
  delegatedTargetId?: string;
  fallbackSuggestions?: FallbackSuggestion[];
}

export interface DeploymentPlanTargetDto {
  id: string;
  tenantId?: string;
  deploymentPlanId: string;
  certificateBindingId: string;
  executionTargetId?: string;
  executorType: ExecutionTargetKind;
  requiredCapabilities: string[];
  matchResult?: Record<string, unknown>;
  gatewayRoute?: DeploymentGatewayRouteDto;
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
  certificateVersionId: string;
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
}

export interface CreateDeploymentPlanInput {
  name: string;
  certificateVersionId: string;
  targets: Array<{
    certificateBindingId: string;
    executionTargetId?: string;
    executorType?: ExecutionTargetKind;
    requiredCapabilities?: string[];
    matchResult?: Record<string, unknown>;
    gatewayRoute?: DeploymentGatewayRouteDto;
    gatewayId?: string;
    zoneId?: string;
    adapter?: GatewayAdapterType;
    delegatedTargetId?: string;
    fallbackSuggestions?: FallbackSuggestion[];
  }>;
  planType?: DeploymentPlanType;
  policy?: DeploymentPlanPolicyDto;
  createdReason?: DeploymentPlanDto['createdReason'];
  idempotencyKey: string;
  actorId: string;
  tenantId?: string;
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
