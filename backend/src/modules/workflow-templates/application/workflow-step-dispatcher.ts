import type { SecretService } from '../../secrets/secret.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { CurlExecutor, type CurlExecutionRequest } from '../../executors/curl/curl.executor.js';
import { SSHExecutor, type SSHExecutionRequest } from '../../executors/ssh/ssh.executor.js';
import type { WorkflowExecutorDispatcher, WorkflowExecutorDispatchResult } from '../dto/workflow-templates.dto.js';

export interface WorkflowStepDispatcherDependencies {
  /**
   * 仅接受调用方显式提供的受控旧执行能力；缺失时必须失败关闭。
   * dispatcher 不再自行创建 Curl/SSH 执行器，避免能力缺失时静默落入旧路径。
   */
  curlExecutor?: Pick<CurlExecutor, 'execute'>;
  sshExecutor?: Pick<SSHExecutor, 'execute'>;
  /** 仅保留应用装配兼容字段；SecretService 不会自动生成执行能力。 */
  secrets?: SecretService;
}

export function createWorkflowStepDispatcher(dependencies: WorkflowStepDispatcherDependencies = {}): WorkflowExecutorDispatcher {
  const curlExecutor = dependencies.curlExecutor;
  const sshExecutor = dependencies.sshExecutor;

  return async (input) => {
    const plan = asRecord(input.renderedPlan);
    if (plan && isPluginWorkflowPlan(plan)) return pluginWorkflowLegacyExecutorFailure(plan);

    const executor = asString(plan?.executor);
    if (!executor) return executorRequiredFailure();
    const dryRun = input.dryRun === true || plan?.dryRun === true;

    if (executor === '017.CURL_HTTP') {
      if (!curlExecutor) return executionCapabilityMissing(executor);
      const request = toCurlExecutionRequest(plan, input.runId, input.step.name, input.attempt, dryRun);
      if (!request) return { success: false, errorCode: 'CURL_REQUEST_REQUIRED', errorMessage: '工作流节点缺少 curlRequest' };
      try {
        const result = await curlExecutor.execute(request, request.dryRun === true, {
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
      if (!sshExecutor) return executionCapabilityMissing(executor);
      const request = toSshExecutionRequest(plan, input.runId, input.step.name, input.attempt, dryRun);
      try {
        const result = await sshExecutor.execute(request, request.dryRun === true, {
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

    if (plannedOnlyExecutorIds.has(executor)) {
      return {
        success: true,
        body: { plannedOnly: true, executor },
        logs: [`workflow:${executor}:planned`],
      };
    }

    return {
      success: false,
      errorCode: 'WORKFLOW_EXECUTOR_NOT_REGISTERED',
      errorMessage: `工作流执行器未注册：${executor}`,
      body: { executor },
      logs: [`workflow:${executor}:rejected:unregistered`],
    };
  };
}

const plannedOnlyExecutorIds = new Set([
  'workflow.condition',
  'workflow.wait',
  'workflow.manual',
  'workflow.checkpoint',
  'workflow.checkpoint_verify',
]);

function executorRequiredFailure(): WorkflowExecutorDispatchResult {
  return {
    success: false,
    errorCode: 'WORKFLOW_EXECUTOR_REQUIRED',
    errorMessage: '工作流节点缺少 executor',
    logs: ['workflow:error:executor_required'],
  };
}

function executionCapabilityMissing(executor: string): WorkflowExecutorDispatchResult {
  return {
    success: false,
    errorCode: 'CAPABILITY_MISSING',
    errorMessage: `工作流执行器缺少受控执行能力：${executor}`,
    body: { executor },
    logs: [`workflow:${executor}:rejected:capability_missing`],
  };
}

function pluginWorkflowLegacyExecutorFailure(plan: Record<string, unknown>): WorkflowExecutorDispatchResult {
  return {
    success: false,
    errorCode: 'PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN',
    errorMessage: '包级 PluginWorkflow 已禁止，旧 Curl/SSH 执行器已拒绝',
    body: {
      kind: asString(plan.kind),
      executionMode: asString(plan.executionMode),
      executor: asString(plan.executor),
    },
    logs: ['workflow:plugin-runner:legacy-executor:rejected'],
  };
}

function isPluginWorkflowPlan(plan: Record<string, unknown> | undefined): boolean {
  if (!plan) return false;
  const executionBinding = asRecord(plan.executionBinding);
  return plan.pluginWorkflow === true
    || plan.kind === 'PluginWorkflow'
    || plan.executionMode === 'PLUGIN_RUNNER'
    || plan.runner === 'gcac.plugin-runner/v1'
    || executionBinding?.runner === 'gcac.plugin-runner/v1';
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
  return ['target', 'stage', 'category', 'cause', 'suggestion', 'step', 'extractor', 'source', 'path', 'header', 'pattern', 'responseStatusCode', 'outputStatusCode']
    .flatMap((key) => {
      const value = asString(detail[key]) ?? asNumberString(detail[key]);
      return value ? [`${kind}:${key}:${value}`] : [];
    });
}

function toCurlExecutionRequest(plan: Record<string, unknown> | undefined, runId: string, stepName: string, attempt: number, dryRun: boolean): CurlExecutionRequest | undefined {
  const directRequest = asRecord(plan?.curlRequest);
  if (!directRequest) return undefined;
  return {
    ...(directRequest as Partial<CurlExecutionRequest>),
    idempotencyKey: `workflow-step:${runId}:${stepName}:curl:${attempt}`,
    ...(dryRun || directRequest.dryRun === true ? { dryRun: true } : {}),
  } as CurlExecutionRequest;
}

function toSshExecutionRequest(plan: Record<string, unknown> | undefined, runId: string, stepName: string, attempt: number, dryRun: boolean): SSHExecutionRequest {
  const connection = asRecord(plan?.connection);
  const directRequest = asRecord(plan?.sshRequest);
  const direct = directRequest as Partial<SSHExecutionRequest> | undefined;
  return {
    ...direct,
    idempotencyKey: `workflow-step:${runId}:${stepName}:ssh:${attempt}`,
    connection: ((directRequest?.connection ?? connection) as unknown as SSHExecutionRequest['connection']),
    program: asString(plan?.program) as SSHExecutionRequest['program'] ?? direct?.program,
    args: asStringArray(plan?.args) ?? direct?.args,
    argumentTemplate: asString(plan?.argumentTemplate) as SSHExecutionRequest['argumentTemplate'] ?? direct?.argumentTemplate,
    timeoutMs: typeof plan?.timeoutMs === 'number' ? plan.timeoutMs : direct?.timeoutMs,
    dryRun: dryRun || direct?.dryRun === true,
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

function asNumberString(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}
