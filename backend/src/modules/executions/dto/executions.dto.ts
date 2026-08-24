import type { ExecutionRunStatus, ExecutionStepStatus, ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import type { DeploymentGatewayRouteDto, DeploymentPlanPolicyDto } from '../../deployment-plans/dto/deployment-plans.dto.js';

export type ExecutionRunType = 'apply' | 'dry_run' | 'rollback';
export interface ExecutionSourceDto {
  type: 'deployment_plan' | 'automation';
  automationRunId?: string;
  automationId?: string;
}
export type ExecutionStepType = 'DISCOVER' | 'BACKUP' | 'INSTALL' | 'RELOAD' | 'VERIFY' | 'ROLLBACK' | 'CUSTOM';
export type ExecutionFailureCategory = 'transient' | 'unsafe' | 'timeout' | 'cancelled';

export interface ExecutionRunDto {
  id: string;
  tenantId?: string;
  deploymentPlanId: string;
  executionTargetId?: string;
  runNo: number;
  type: ExecutionRunType;
  idempotencyKey: string;
  externalRunId?: string;
  status: ExecutionRunStatus;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  concurrencyLimit?: number;
  recoveryAttemptCount?: number;
  lastRecoveryAt?: string;
  summary: Record<string, unknown>;
  source?: ExecutionSourceDto;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  version: number;
}

export interface ExecutionStepDto {
  id: string;
  tenantId?: string;
  executionRunId: string;
  deploymentPlanTargetId?: string;
  stepNo: number;
  stepType: ExecutionStepType;
  name: string;
  dependsOn?: number[];
  idempotent?: boolean;
  attemptCount: number;
  maxAttempts: number;
  lastFailureCategory?: ExecutionFailureCategory;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastErrorDetails?: Record<string, unknown>;
  inputSnapshot: Record<string, unknown>;
  status: ExecutionStepStatus;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  version: number;
}

export interface CreateExecutionRunInput {
  deploymentPlanId: string;
  deploymentPlanTargetIds: string[];
  type: ExecutionRunType;
  idempotencyKey: string;
  actorId: string;
  tenantId?: string;
  executorTypeByTargetId: Map<string, ExecutionTargetKind | 'MOCK' | string>;
  gatewayRouteByTargetId?: Map<string, DeploymentGatewayRouteDto | undefined>;
  agentPayloadByTargetId?: Map<string, Record<string, unknown>>;
  mockResultByTargetId?: Map<string, 'success' | 'fail'>;
  concurrencyLimit?: number;
  stepMaxAttempts?: number;
  failurePolicy?: NonNullable<DeploymentPlanPolicyDto['failurePolicy']>;
  retry?: DeploymentPlanPolicyDto['retry'];
  allowMockExecutor?: boolean;
  source?: ExecutionSourceDto;
}

export interface DeploymentArtifactSnapshotDto {
  certificateVersionId: string;
  certificateFormatId: string;
  format: string;
  containsPrivateKey: boolean;
  certificatePem?: string;
  privateKeyPem?: string;
  pfxBase64?: string;
  pfxPassword?: string;
  expectedFingerprintSha256?: string;
  warnings?: string[];
  files?: Array<{
    name?: string;
    key?: string;
    role: 'public_certificate' | 'private_key' | 'certificate_chain' | 'bundle' | string;
    format?: string;
    content?: string;
    contentBase64?: string;
    contentEncoding?: 'utf8' | 'base64' | string;
  }>;
  workflowCertificateMaterials?: Record<string, Record<string, unknown>>;
}

export interface RetryExecutionRunInput {
  runId: string;
  actorId: string;
  tenantId?: string;
  idempotencyKey: string;
}

export interface RollbackExecutionRunInput {
  runId: string;
  actorId: string;
  tenantId?: string;
  idempotencyKey: string;
  approvalId?: string;
}
