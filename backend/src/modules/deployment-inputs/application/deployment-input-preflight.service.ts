import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentInputIssueV1 } from '../dto/resolved-deployment-input.dto.js';

export interface DeploymentInputPreflightIssue extends Partial<DeploymentInputIssueV1> {
  stage: 'TARGET' | 'VERSION' | 'ARTIFACT' | 'INPUT';
  targetIndex: number;
  errorCode: string;
  message: string;
  details?: unknown;
}

export class DeploymentInputPreflightService {
  collect<T>(
    stage: DeploymentInputPreflightIssue['stage'],
    results: readonly PromiseSettledResult<T>[],
    targetIndexes: readonly number[] = results.map((_, index) => index),
  ): DeploymentInputPreflightIssue[] {
    return results.flatMap((result, index) => result.status === 'fulfilled'
      ? []
      : this.fromError(stage, targetIndexes[index] ?? index, result.reason));
  }

  fromError(stage: DeploymentInputPreflightIssue['stage'], targetIndex: number, error: unknown): DeploymentInputPreflightIssue[] {
    const nested = readDeploymentInputIssues(error);
    if (nested.length > 0) {
      return nested.map((issue) => ({
        stage: 'INPUT',
        targetIndex,
        errorCode: issue.code,
        message: issue.messageKey,
        ...issue,
      }));
    }
    return [{
      stage,
      targetIndex,
      errorCode: error instanceof AppError ? error.errorCode : 'SYSTEM_INTERNAL_ERROR',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof AppError && error.details !== undefined ? { details: error.details } : {}),
    }];
  }
}

function readDeploymentInputIssues(error: unknown): DeploymentInputIssueV1[] {
  if (!(error instanceof AppError)) return [];
  const details = readRecord(error.details);
  if (!Array.isArray(details?.issues)) return [];
  return details.issues.filter(isDeploymentInputIssue);
}

function isDeploymentInputIssue(value: unknown): value is DeploymentInputIssueV1 {
  const issue = readRecord(value);
  return Boolean(issue)
    && typeof issue?.category === 'string'
    && typeof issue?.code === 'string'
    && typeof issue?.severity === 'string'
    && typeof issue?.messageKey === 'string';
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
