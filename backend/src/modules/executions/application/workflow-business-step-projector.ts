import type { ExecutionStepType } from '../dto/executions.dto.js';
import type { WorkflowProgressStep, WorkflowRunProgress, WorkflowRunResult, WorkflowStepRunResult } from '../../workflow-templates/dto/workflow-templates.dto.js';

export interface WorkflowExecutionStepProjection {
  id: string;
  parentExecutionStepId: string;
  workflowStepNo: number;
  name: string;
  stepType: ExecutionStepType;
  workflowType: string;
  stage?: string;
  status: string;
  dependsOn: number[];
  compensation: boolean;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  detail: Record<string, unknown>;
}

export function projectWorkflowBusinessSteps(parentExecutionStepId: string, source: WorkflowRunResult | WorkflowRunProgress): WorkflowExecutionStepProjection[] {
  const forward = 'stepResults' in source ? source.stepResults : source.steps;
  const rollback = 'rollbackResults' in source ? source.rollbackResults : [];
  const expandedForward = flattenSteps(forward);
  const expandedRollback = flattenSteps(rollback);
  const projectedForward = expandedForward.map((step, index) => project(parentExecutionStepId, step, index + 1, index === 0 ? [] : [index], false));
  const rollbackOffset = projectedForward.length;
  const projectedRollback = expandedRollback.map((step, index) => project(
    parentExecutionStepId,
    step,
    rollbackOffset + index + 1,
    index === 0 ? (projectedForward.length ? [projectedForward.length] : []) : [rollbackOffset + index],
    true,
  ));
  return [...projectedForward, ...projectedRollback];
}

function flattenSteps(steps: Array<WorkflowStepRunResult | WorkflowProgressStep>): Array<WorkflowStepRunResult | WorkflowProgressStep> {
  return steps.flatMap((step) => {
    const children = 'children' in step && Array.isArray(step.children) ? step.children : [];
    return children.length ? [step, ...children] : [step];
  });
}

function project(
  parentExecutionStepId: string,
  step: WorkflowStepRunResult | WorkflowProgressStep,
  workflowStepNo: number,
  dependsOn: number[],
  compensation: boolean,
): WorkflowExecutionStepProjection {
  return {
    id: `${parentExecutionStepId}:workflow:${compensation ? 'rollback:' : ''}${step.name}`,
    parentExecutionStepId,
    workflowStepNo,
    name: compensation ? `rollback.${step.name}` : step.name,
    stepType: mapStepType(step.stage, step.type, compensation),
    workflowType: step.type,
    stage: step.stage,
    status: mapStatus(step.status),
    dependsOn,
    compensation,
    attempts: step.attempts,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    errorCode: step.errorCode,
    errorMessage: step.errorMessage,
    detail: {
      assertions: step.assertions,
      logs: step.logs,
      ...('plan' in step ? { plan: step.plan, extracted: step.extracted } : {}),
    },
  };
}

function mapStepType(stage: string | undefined, workflowType: string, compensation: boolean): ExecutionStepType {
  if (compensation) return 'ROLLBACK';
  if (workflowType === 'checkpoint' || stage === 'backup') return 'BACKUP';
  if (stage === 'install') return 'INSTALL';
  if (stage === 'refresh') return 'RELOAD';
  if (stage === 'verify') return 'VERIFY';
  if (stage === 'prepare') return 'DISCOVER';
  return 'CUSTOM';
}

function mapStatus(status: string): string {
  if (status === 'queued') return 'PENDING';
  if (status === 'running') return 'RUNNING';
  if (status === 'success') return 'SUCCESS';
  if (status === 'failed') return 'FAILED';
  if (status === 'skipped') return 'SKIPPED';
  return status.toUpperCase();
}
