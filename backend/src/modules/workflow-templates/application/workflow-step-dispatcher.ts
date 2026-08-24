import type { SecretService } from '../../secrets/secret.service.js';
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
      const request = asRecord(plan?.curlRequest) as CurlExecutionRequest | undefined;
      if (!request) return { success: false, errorCode: 'CURL_REQUEST_REQUIRED', errorMessage: '工作流节点缺少 curlRequest' };
      const result = await curlExecutor.execute(request, false, {
        runId: `workflow-step:${input.step.name}`,
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
    }
    if (executor === '015.SSH') {
      const request = toSshExecutionRequest(plan, input.step.name, input.attempt);
      const result = await sshExecutor.execute(request, false, {
        runId: `workflow-step:${input.step.name}`,
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
    }
    return {
      success: true,
      body: { plannedOnly: true, executor: executor ?? 'workflow.internal' },
      logs: [`workflow:${executor ?? 'workflow.internal'}:planned`],
    };
  };
}

function toSshExecutionRequest(plan: Record<string, unknown> | undefined, stepName: string, attempt: number): SSHExecutionRequest {
  const connection = asRecord(plan?.connection);
  const directRequest = asRecord(plan?.sshRequest);
  return {
    idempotencyKey: `workflow-step:${stepName}:ssh:${attempt}`,
    connection: ((directRequest?.connection ?? connection) as unknown as SSHExecutionRequest['connection']),
    command: asString(plan?.command),
    commands: asStringArray(plan?.commands),
    script: asString(plan?.script),
    timeoutMs: typeof plan?.timeoutMs === 'number' ? plan.timeoutMs : undefined,
    dryRun: false,
    ...(directRequest as Partial<SSHExecutionRequest> | undefined),
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
