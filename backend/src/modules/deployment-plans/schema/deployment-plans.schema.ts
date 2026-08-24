import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type { DeploymentPlanStatus, ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { DeploymentGatewayRouteDto, DeploymentPlanApprovalStatus, DeploymentPlanPolicyDto, DeploymentPlanSelectionMode, DeploymentPlanTargetStatus, DeploymentPlanType } from '../dto/deployment-plans.dto.js';
import type { AgentSecurityStatus } from '../../agents/security/agent-security.contract.js';

export interface DeploymentPlanEntity extends IdentifiedEntity {
  tenantId?: string;
  name: string;
  planType: DeploymentPlanType;
  selectionMode: DeploymentPlanSelectionMode;
  certificateVersionId: string;
  certificateFormatId?: string;
  status: DeploymentPlanStatus;
  /** 执行安全终态；UNKNOWN 表示写入是否发生无法确认。 */
  executionStatus?: AgentSecurityStatus;
  approvalStatus: DeploymentPlanApprovalStatus;
  approvalId?: string;
  snapshotHash: string;
  idempotencyKey: string;
  requestHash: string;
  policy: DeploymentPlanPolicyDto;
  createdReason: 'MANUAL' | 'AUTO_RENEW' | 'RISK_FIX' | 'ROLLBACK';
  temporary?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  version: number;
}

export interface DeploymentPlanTargetEntity extends IdentifiedEntity {
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
  /** 目标执行安全终态；不替代目标生命周期 status。 */
  executionStatus?: AgentSecurityStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  version: number;
}

export interface StateTransitionEventEntity extends IdentifiedEntity {
  tenantId?: string;
  entityType: 'deploymentPlan' | 'executionRun' | 'executionStep';
  entityId: string;
  fromStatus?: string;
  toStatus: string;
  event: string;
  actorType: 'user' | 'system' | 'orchestrator';
  actorId?: string;
  reason?: string;
  createdAt: string;
}

export const deploymentPlanPublicSchema = {
  type: 'object',
  additionalProperties: true,
} as const;
