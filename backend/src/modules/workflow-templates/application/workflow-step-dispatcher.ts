import type { SecretService } from '../../secrets/secret.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { CurlExecutor, type CurlExecutionRequest } from '../../executors/curl/curl.executor.js';
import type { CurlSecretResolverContext } from '../../executors/curl/curl.secret-resolver.js';
import { SSHExecutor, type SSHExecutionRequest } from '../../executors/ssh/ssh.executor.js';
import type { ExecutionGrantService } from '../../executions/execution-grant.service.js';
import type { WorkflowExecutorDispatcher, WorkflowExecutorDispatchResult } from '../dto/workflow-templates.dto.js';

export interface WorkflowStepDispatcherDependencies {
  /**
   * 仅接受调用方显式提供的受控旧执行能力；缺失时必须失败关闭。
   * dispatcher 不再自行创建 Curl/SSH 执行器，避免能力缺失时静默落入旧路径。
   */
  curlExecutor?: Pick<CurlExecutor, 'execute'> & Partial<Pick<CurlExecutor, 'executeForWorkflow'>>;
  sshExecutor?: Pick<SSHExecutor, 'execute'>;
  /** 仅保留应用装配兼容字段；SecretService 不会自动生成执行能力。 */
  secrets?: SecretService;
  /**
   * 宿主导入的 ExecutionGrant 服务。Curl 步骤需要 TLS 例外（verify=false）时，
   * dispatcher 只签发绑定当前 run/step 的短期 Grant 交给 CurlExecutor 校验，
   * 不绕过旧执行器自身的 TLS 授权链；该 Grant 不再依赖用户审批号。
   */
  executionGrantService?: ExecutionGrantService;
}

const grantTtlMs = 5 * 60_000;

export function createWorkflowStepDispatcher(dependencies: WorkflowStepDispatcherDependencies = {}): WorkflowExecutorDispatcher {
  const curlExecutor = dependencies.curlExecutor;
  const sshExecutor = dependencies.sshExecutor;
  const executionGrantService = dependencies.executionGrantService;

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
      let curlGrantId: string | undefined;
      try {
        curlGrantId = await authorizeCurlExecutionGrant(request, {
          runId: input.runId,
          stepName: input.step.name,
          tenantId: input.tenantId,
          workflowVersionId: input.workflowVersionId,
        }, executionGrantService);
        const curlContext: CurlSecretResolverContext = {
          runId: input.runId,
          stepId: input.step.name,
          tenantId: input.tenantId,
          workflowVersionId: input.workflowVersionId,
          actorId: 'workflow-step-test',
          executionGrantService,
          ...(request.template.tls?.allowInsecure === true ? { allowInsecureTls: true } : {}),
          ...(curlGrantId ? { executionGrantId: curlGrantId } : {}),
        };
        // 工作流的后续步骤可能需要读取当前响应中的敏感提取值（例如登录 JWT）。
        // execute() 返回的是对外脱敏结果，不能再拿它作为下一步的运行时输入。
        if (typeof curlExecutor.executeForWorkflow === 'function') {
          const execution = await curlExecutor.executeForWorkflow(request, request.dryRun === true, curlContext);
          const runtimeResponse = execution.runtimeResponse;
          return {
            success: execution.result.success,
            statusCode: runtimeResponse?.statusCode ?? execution.result.statusCode ?? (execution.result.success ? 200 : 500),
            headers: runtimeResponse?.headers ?? execution.result.headers,
            body: runtimeResponse?.bodyJson ?? runtimeResponse?.body ?? runtimeResponse?.bodyText ?? execution.result.bodyJson ?? execution.result.bodyText,
            stdout: runtimeResponse?.bodyText ?? (runtimeResponse?.bodyJson === undefined ? execution.result.bodyText : JSON.stringify(runtimeResponse.bodyJson)),
            logs: execution.result.logs,
            raw: execution.result,
            errorCode: execution.result.errorCode,
            errorMessage: execution.result.errorMessage,
          };
        }

        const result = await curlExecutor.execute(request, request.dryRun === true, curlContext);
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
      } finally {
        if (curlGrantId) await executionGrantService?.revoke(curlGrantId);
      }
    }
    if (executor === '015.SSH') {
      if (!sshExecutor) return executionCapabilityMissing(executor);
      const request = toSshExecutionRequest(plan, input.runId, input.step.name, input.attempt, dryRun);
      try {
        const result = await sshExecutor.execute(request, request.dryRun === true, {
          runId: input.runId,
          stepId: input.step.name,
          tenantId: input.tenantId,
          workflowVersionId: input.workflowVersionId,
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

/**
 * TLS 例外或 CookieSession 都必须绑定当前 run/step 的短期 Grant。
 * TLS 例外不再要求调用方提供 approvalId；allowInsecureTls 仍必须由插件输入契约显式绑定。
 */
async function authorizeCurlExecutionGrant(
  request: CurlExecutionRequest,
  input: {
    runId: string;
    stepName: string;
    tenantId?: string;
    workflowVersionId?: string;
  },
  executionGrantService: ExecutionGrantService | undefined,
): Promise<string | undefined> {
  const tls = request.template.tls;
  const needsTlsGrant = tls?.verify === false && tls.allowInsecure === true;
  const needsCookieGrant = typeof request.template.cookieSessionRef === 'string';
  if (!needsTlsGrant && !needsCookieGrant) return undefined;
  if (!input.tenantId || !executionGrantService) return undefined;
  const grant = await executionGrantService.create({
    tenantId: input.tenantId,
    runId: input.runId,
    stepId: input.stepName,
    workflowVersionId: input.workflowVersionId,
    executorType: '017.CURL_HTTP',
    allowedSecretRefs: collectReferencesByScheme(request, 'secret://'),
    allowedActions: [
      'workflow.step.execute',
      '017.CURL_HTTP',
      ...(needsTlsGrant ? ['workflow.tls.insecure'] : []),
      ...(needsCookieGrant ? ['http.cookie.session'] : []),
    ],
    expiresAt: new Date(Date.now() + grantTtlMs).toISOString(),
  });
  return grant.id;
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

function collectReferencesByScheme(value: unknown, scheme: string): string[] {
  const found: string[] = [];
  collectReferences(value, scheme, found);
  return [...new Set(found)];
}

function collectReferences(value: unknown, scheme: string, found: string[]): void {
  if (typeof value === 'string') {
    if (value.startsWith(scheme)) found.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, scheme, found);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) collectReferences(child, scheme, found);
  }
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
