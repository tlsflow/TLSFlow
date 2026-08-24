import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type { ExecutionRunStatus, ExecutionStepStatus } from '../../../shared/enums/core.enums.js';
import type { ExecutionFailureCategory, ExecutionRunType, ExecutionStepType } from '../dto/executions.dto.js';

export interface ExecutionRunEntity extends IdentifiedEntity {
  tenantId?: string;
  deploymentPlanId: string;
  executionTargetId?: string;
  runNo: number;
  type: ExecutionRunType;
  idempotencyKey: string;
  requestHash: string;
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
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  version: number;
}

export interface ExecutionStepEntity extends IdentifiedEntity {
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

export const executionRunPublicSchema = {
  type: 'object',
  additionalProperties: true,
} as const;
