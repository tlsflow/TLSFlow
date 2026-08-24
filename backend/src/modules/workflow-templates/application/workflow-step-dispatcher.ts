import type { SecretService } from '../../secrets/secret.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { CurlExecutor, type CurlExecutionRequest } from '../../executors/curl/curl.executor.js';
import type { CurlSecretResolverContext } from '../../executors/curl/curl.secret-resolver.js';
import { SSHExecutor, type SSHExecutionRequest } from '../../executors/ssh/ssh.executor.js';
import type { ExecutionGrantService } from '../../executions/execution-grant.service.js';
import type { WorkflowExecutionAuthorization, WorkflowExecutorDispatcher, WorkflowExecutorDispatchResult, WorkflowTestRunMode } from '../dto/workflow-templates.dto.js';

export interface WorkflowStepDispatcherDependencies {
  /**
   * 仅接受调用方显式提供的受控旧执行能力；缺失时必须失败关闭。
   * dispatcher 不再自行创建 Curl/SSH 执行器，避免能力缺失时静默落入旧路径。
   */
  curlExecutor?: Pick<CurlExecutor, 'execute'>;
  sshExecutor?: Pick<SSHExecutor, 'execute'>;
  /** 仅保留应用装配兼容字段；SecretService 不会自动生成执行能力。 */
  secrets?: SecretService;
  /**
   * 宿主导入的 ExecutionGrant 服务。Curl 步骤需要 TLS 例外（verify=false）时，
   * dispatcher 只签发绑定当前 run/step 的短期 Grant 交给 CurlExecutor 校验，
   * 不绕过旧执行器自身的 TLS 授权链。
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
      let tlsBypassGrantId: string | undefined;
      try {
        tlsBypassGrantId = await authorizeCurlTlsBypass(request, {
          runId: input.runId,
          stepName: input.step.name,
          tenantId: input.tenantId,
          workflowVersionId: input.workflowVersionId,
          mode: input.mode,
          dryRun,
          authorization: input.authorization,
        }, executionGrantService);
        const curlContext: CurlSecretResolverContext = {
          runId: input.runId,
          stepId: input.step.name,
          tenantId: input.tenantId,
          workflowVersionId: input.workflowVersionId,
          actorId: 'workflow-step-test',
          executionGrantService,
          ...(input.authorization?.approvalId ? { approvalId: input.authorization.approvalId } : {}),
          ...(tlsBypassGrantId ? { allowInsecureTls: true, executionGrantId: tlsBypassGrantId } : {}),
        };
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
        if (tlsBypassGrantId) await executionGrantService?.revoke(tlsBypassGrantId);
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
 * 只有 DSL 显式声明 tls.allowInsecure 意图、渲染结果 verify=false（设备绑定关闭校验），
 * 并满足 real_test 的审批上下文、租户上下文与 ExecutionGrant 服务时，才签发绑定当前 run/step 的短期 Grant。
 * 其余情况不签发 Grant，CurlExecutor 自身的 TLS 授权链会失败关闭，绝不静默降级。
 */
async function authorizeCurlTlsBypass(
  request: CurlExecutionRequest,
  input: {
    runId: string;
    stepName: string;
    tenantId?: string;
    workflowVersionId?: string;
    mode?: WorkflowTestRunMode;
    dryRun: boolean;
    authorization?: WorkflowExecutionAuthorization;
  },
  executionGrantService: ExecutionGrantService | undefined,
): Promise<string | undefined> {
  const tls = request.template.tls;
  if (tls?.verify !== false) return undefined;
  if (tls.allowInsecure !== true) return undefined;
  if (!input.dryRun
    && (input.authorization?.approved !== true || !input.authorization.approvalId)) {
    throw new AppError('AUTH_FORBIDDEN', 'real_test 的 TLS 跳过校验必须携带已批准的 approvalId', {
      policy: 'workflow.tls.insecure',
      reason: 'approval_required',
    });
  }
  if (!input.tenantId || !executionGrantService) return undefined;
  const grant = await executionGrantService.create({
    tenantId: input.tenantId,
    runId: input.runId,
    stepId: input.stepName,
    workflowVersionId: input.workflowVersionId,
    approvalId: input.authorization?.approvalId,
    executorType: '017.CURL_HTTP',
    allowedSecretRefs: collectReferencesByScheme(request, 'secret://'),
    allowedActions: ['workflow.step.execute', '017.CURL_HTTP', 'workflow.tls.insecure'],
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
