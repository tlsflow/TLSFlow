import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type {
  AutomationActionType,
  AutomationConfigurationDto,
  AutomationFailureStage,
  AutomationRunStatus,
  AutomationRunTargetStatus,
  AutomationRunTriggerType,
  AutomationStatus,
  AutomationTargetSnapshotDto,
  AutomationTargetSummaryDto,
} from '../dto/automations.dto.js';

export interface AutomationEntity extends IdentifiedEntity {
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

export interface AutomationVersionEntity extends IdentifiedEntity, AutomationConfigurationDto {
  tenantId: string;
  automationId: string;
  version: number;
  checksum: string;
  createdBy: string;
  createdAt: string;
}

export interface AutomationRunEntity extends IdentifiedEntity {
  tenantId: string;
  automationId: string;
  automationVersion: number;
  automationNameSnapshot: string;
  triggerType: AutomationRunTriggerType;
  scheduledAt?: string;
  idempotencyKey: string;
  parentRunId?: string;
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

export interface AutomationRunTargetEntity extends IdentifiedEntity {
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

export interface AutomationRunActionResultEntity extends IdentifiedEntity {
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

export const automationPublicSchema = {
  type: 'object',
  additionalProperties: true,
} as const;
