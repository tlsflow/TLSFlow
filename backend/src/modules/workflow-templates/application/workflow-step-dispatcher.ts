import type { SecretService } from '../../secrets/secret.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { CurlExecutor, type CurlExecutionRequest } from '../../executors/curl/curl.executor.js';
import { SecretServiceCurlResolver } from '../../executors/curl/curl.secret-resolver.js';
import { SSHExecutor, type SSHExecutionRequest } from '../../executors/ssh/ssh.executor.js';
import { SecretServiceSshResolver } from '../../executors/ssh/ssh.secret-resolver.js';
import type { WorkflowExecutorDispatcher, WorkflowExecutorDispatchResult } from '../dto/workflow-templates.dto.js';

export interface WorkflowStepDispatcherDependencies {
  secrets?: SecretService;
  curlExecutor?: CurlExecutor;
  sshExecutor?: SSHExecutor;
}

export function createWorkflowStepDispatcher(dependencies: WorkflowStepDispatcherDependencies = {}): WorkflowExecutorDispatcher {
  const curlExecutor = dependencies.curlExecutor ?? new CurlExecutor(
    dependencies.secrets ? { secretResolver: new SecretServiceCurlResolver(dependencies.secrets) } : {},
  );
  const sshExecutor = dependencies.sshExecutor ?? new SSHExecutor(
    dependencies.secrets ? { secretResolver: new SecretServiceSshResolver(dependencies.secrets) } : {},
  );

  return async (input) => {
    const plan = asRecord(input.renderedPlan);
    const executor = asString(plan?.executor);
    if (executor === '017.CURL_HTTP') {
      const request = toCurlExecutionRequest(plan, input.runId, input.step.name, input.attempt);
      if (!request) return { success: false, errorCode: 'CURL_REQUEST_REQUIRED', errorMessage: '工作流节点缺少 curlRequest' };
      try {
        const result = await curlExecutor.execute(request, false, {
          runId: input.runId,
          stepId: input.step.name,
          actorId: 'workflow-step-test',
        });
        return {
          success: result.success,
          statusCode: result.statusCode ?? (result.success ? 200 : 500),
          headers: result.headers,
          body: result.bodyJson ?? result.bodyText,
          stdout: result.bodyText ?? JSON.stringify(result.bodyJson ?? {}),
          logs: result.logs,
          raw: result,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        };
      } catch (error) {
        return executorFailure('curl', error, 'CURL_EXECUTION_FAILED');
      }
    }
    if (executor === '015.SSH') {
      const request = toSshExecutionRequest(plan, input.runId, input.step.name, input.attempt);
      try {
        const result = await sshExecutor.execute(request, false, {
          runId: input.runId,
          stepId: input.step.name,
          actorId: 'workflow-step-test',
        });
        const stdout = result.commandResult?.stdout
          ?? (result.transferResults ? JSON.stringify(result.transferResults) : '');
        const stderr = result.commandResult?.stderr;
        return {
          success: result.success,
          exitCode: result.exitCode ?? (result.success ? 0 : 1),
          stdout,
          body: result,
          logs: [
            `ssh:mode:${result.mode}`,
            ...(stdout ? [`ssh:stdout:${stdout}`] : []),
            ...(stderr ? [`ssh:stderr:${stderr}`] : []),
          ],
          raw: result,
          errorCode: result.commandResult?.errorCode,
          errorMessage: result.commandResult?.errorMessage,
        };
      } catch (error) {
        return executorFailure('ssh', error, 'SSH_EXECUTION_FAILED');
      }
    }
    return {
      success: true,
      body: { plannedOnly: true, executor: executor ?? 'workflow.internal' },
      logs: [`workflow:${executor ?? 'workflow.internal'}:planned`],
    };
  };
}

function executorFailure(kind: 'curl' | 'ssh', error: unknown, fallbackCode: string): WorkflowExecutorDispatchResult {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof AppError ? error.details : undefined;
  const detailRecord = asRecord(detail);
  const errorCode = asString(detailRecord?.sshErrorCode)
    ?? (error instanceof AppError ? error.errorCode : undefined)
    ?? fallbackCode;
  return {
    success: false,
    ...(kind === 'ssh' ? { exitCode: 1 } : {}),
    ...(kind === 'curl' ? { statusCode: 0 } : {}),
    stdout: '',
    body: {
      errorCode,
      errorMessage: message,
      detail,
    },
    logs: [
      `${kind}:error:${message}`,
      ...detailLogLines(kind, detailRecord),
    ],
    raw: { errorCode, errorMessage: message, detail },
    errorCode,
    errorMessage: message,
  };
}

function detailLogLines(kind: 'curl' | 'ssh', detail: Record<string, unknown> | undefined): string[] {
  if (!detail) return [];
  return ['target', 'stage', 'category', 'cause', 'suggestion']
    .flatMap((key) => {
      const value = asString(detail[key]);
      return value ? [`${kind}:${key}:${value}`] : [];
    });
}

function toCurlExecutionRequest(plan: Record<string, unknown> | undefined, runId: string, stepName: string, attempt: number): CurlExecutionRequest | undefined {
  const directRequest = asRecord(plan?.curlRequest);
  if (!directRequest) return undefined;
  return {
    ...(directRequest as Partial<CurlExecutionRequest>),
    idempotencyKey: `workflow-step:${runId}:${stepName}:curl:${attempt}`,
    dryRun: false,
  } as CurlExecutionRequest;
}

function toSshExecutionRequest(plan: Record<string, unknown> | undefined, runId: string, stepName: string, attempt: number): SSHExecutionRequest {
  const connection = asRecord(plan?.connection);
  const directRequest = asRecord(plan?.sshRequest);
  const direct = directRequest as Partial<SSHExecutionRequest> | undefined;
  return {
    ...direct,
    idempotencyKey: `workflow-step:${runId}:${stepName}:ssh:${attempt}`,
    connection: ((directRequest?.connection ?? connection) as unknown as SSHExecutionRequest['connection']),
    command: asString(plan?.command) ?? direct?.command,
    commands: asStringArray(plan?.commands) ?? direct?.commands,
    script: asString(plan?.script) ?? direct?.script,
    timeoutMs: typeof plan?.timeoutMs === 'number' ? plan.timeoutMs : direct?.timeoutMs,
    dryRun: false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((item) => String(item)) : undefined;
}
