import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import { ForwardingGrantService } from '../../gateway-agents/forwarding-grant.service.js';
import type { GatewayTaskAuditWriter } from '../../gateway-agents/gateway-target-history.service.js';
import { GatewayTaskService } from '../../gateway-agents/gateway-task.service.js';
import { LegacyTaskDispatcher } from '../../legacy-agents/legacy-task-dispatcher.js';
import { LegacyTaskTranslator } from '../../legacy-agents/legacy-task-translator.js';
import type { LegacyAgentProfile, UnifiedLegacyStep } from '../../legacy-agents/legacy-agent.types.js';
import { CurlExecutor, SSHExecutor, WindowsRemoteExecutor, type CurlExecutionRequest, type CurlExecutionResult, type HttpResponse } from '../../executors/index.js';
import { SecretServiceCurlResolver } from '../../executors/curl/curl.secret-resolver.js';
import { SecretServiceSshResolver } from '../../executors/ssh/ssh.secret-resolver.js';
import { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowConnectionBinding, WorkflowExecutorDispatchResult, WorkflowRunProgress, WorkflowRunResult } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';
import { AgentActionDispatchRegistry } from './agent-action-dispatch-registry.js';
import type { AgentDeploymentPluginsApplicationService } from '../../plugins/application/agent-deployment-plugins.application-service.js';
import type { AgentPluginBindingInput } from '../../plugins/dto/agent-deployment-plugins.dto.js';
import { buildTlsVerifyTargetFromUrl, certificateMatchesDomain, probeTlsCertificate, type TlsVerifyTarget } from './tls-verification.js';

export interface StepExecutionInput {
  step: ExecutionStepEntity;
  runType: string;
  dryRun: boolean;
  reportProgress?: (detail: Record<string, unknown>) => Promise<void> | void;
}

export interface StepExecutionResult {
  success: boolean;
  asyncPending?: boolean;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, unknown>;
}

export interface Executor {
  readonly type: string;
  executeStep(input: StepExecutionInput): Promise<StepExecutionResult>;
}

export class MockExecutor implements Executor {
  readonly type = 'MOCK';

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    if (input.step.inputSnapshot.mockResult === 'fail') {
      return { success: false, errorCode: 'MOCK_STEP_FAILED', errorMessage: '模拟执行失败' };
    }
    return {
      success: true,
      detail: {
        dryRun: input.dryRun,
        stepType: input.step.stepType,
      },
    };
  }
}

export interface ExecutorRegistryOptions {
  /** 只给测试或人工显式 mock 场景使用。生产不允许靠 MOCK 静默兜底。 */
  allowMock?: boolean;
}

export interface DefaultExecutorDependencies {
  agents?: AgentsApplicationService;
  gatewayTasks?: GatewayTaskService;
  gatewayTaskAuditWriter?: GatewayTaskAuditWriter;
  secrets?: SecretService;
  workflows?: WorkflowTemplatesApplicationService;
  agentPlugins?: AgentDeploymentPluginsApplicationService;
}

export class ExecutorRegistry {
  private readonly executors = new Map<string, Executor>();
  private readonly allowMock: boolean;

  constructor(executors: Executor[] = createDefaultExecutors(), options: ExecutorRegistryOptions = {}) {
    this.allowMock = options.allowMock ?? false;
    for (const executor of executors) this.register(executor);
    if (this.allowMock && !this.executors.has('MOCK')) this.register(new MockExecutor());
  }

  static forTests(executors: Executor[] = [new MockExecutor()]): ExecutorRegistry {
    return new ExecutorRegistry(executors, { allowMock: true });
  }

  register(executor: Executor): void {
    const type = normalizeExecutorType(executor.type);
    if (this.executors.has(type)) {
      throw new AppError('VALIDATION_FAILED', '执行器重复注册，拒绝静默覆盖', { executorType: type });
    }
    this.executors.set(type, executor);
  }

  has(type: string): boolean {
    return this.executors.has(normalizeExecutorType(type));
  }

  get(type: string): Executor {
    const normalized = normalizeExecutorType(type);
    if (normalized === 'MOCK' && !this.allowMock) {
      throw new AppError('VALIDATION_FAILED', 'MockExecutor 只能在测试或显式允许时使用，生产执行禁止静默 mock', { executorType: normalized });
    }
    const executor = this.executors.get(normalized);
    if (!executor) {
      throw new AppError('RESOURCE_NOT_FOUND', '执行器未注册，拒绝静默 fallback 到 MockExecutor', { executorType: normalized });
    }
    return executor;
  }

  listTypes(): string[] {
    return [...this.executors.keys()].sort();
  }
}

export function createDefaultExecutorRegistry(options: ExecutorRegistryOptions = {}): ExecutorRegistry {
  return new ExecutorRegistry(createDefaultExecutors(), options);
}

export function createDefaultExecutorRegistryWithDependencies(dependencies: DefaultExecutorDependencies, options: ExecutorRegistryOptions = {}): ExecutorRegistry {
  return new ExecutorRegistry(createDefaultExecutors(dependencies), options);
}

function createDefaultExecutors(dependencies: DefaultExecutorDependencies = {}): Executor[] {
  const sshExecutor = new SSHExecutor(dependencies.secrets ? { secretResolver: new SecretServiceSshResolver(dependencies.secrets) } : {});
  const curlExecutor = new CurlExecutor(dependencies.secrets ? { secretResolver: new SecretServiceCurlResolver(dependencies.secrets) } : {});
  return [
	    sshExecutor,
	    curlExecutor,
	    new WorkflowExecutorAdapter({ workflows: dependencies.workflows, curlExecutor, sshExecutor }),
	    new WindowsRemoteExecutorAdapter('WINRM'),
    new WindowsRemoteExecutorAdapter('SMB_WMI'),
    new AgentExecutorAdapter(dependencies.agents, new AgentActionDispatchRegistry(), dependencies.agentPlugins),
    new GatewayRouteExecutorAdapter({ agents: dependencies.agents, gatewayTasks: dependencies.gatewayTasks, auditWriter: dependencies.gatewayTaskAuditWriter }),
    new ControlPlaneTlsExecutor(),
    new LegacyAgentExecutorAdapter(),
  ];
}

function normalizeExecutorType(type: string): string {
  if (type === 'windows_remote') return 'WINRM';
  return type.trim().toUpperCase();
}

class WindowsRemoteExecutorAdapter implements Executor {
  private readonly delegate = new WindowsRemoteExecutor();

  constructor(readonly type: 'WINRM' | 'SMB_WMI') {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const connection = readRecord(input.step.inputSnapshot.connection);
    const steps = Array.isArray(input.step.inputSnapshot.steps) ? input.step.inputSnapshot.steps : undefined;
    if (!connection || !steps) {
      return { success: true, detail: { mode: 'winrm_mock_safe_adapter', reason: '未提供 connection/steps，仅保留执行器占位，不访问真实 Windows', dryRun: input.dryRun } };
    }
    const result = this.delegate.execute({
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      connection: connection as any,
      steps: steps as any,
      dryRun: input.dryRun,
    });
    return { success: result.success, detail: { mode: 'windows_remote', ...result } };
  }
}

export class AgentExecutorAdapter implements Executor {
  readonly type = 'AGENT';

  constructor(
    private readonly agents = new AgentsApplicationService(),
    private readonly actionDispatch = new AgentActionDispatchRegistry(),
    private readonly agentPlugins?: AgentDeploymentPluginsApplicationService,
  ) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const agentId = stringFromSnapshot(input.step.inputSnapshot.agentId) ?? stringFromSnapshot(input.step.inputSnapshot.executionTargetId) ?? stringFromSnapshot(input.step.inputSnapshot.deploymentPlanTargetId);
    if (!agentId) return { success: false, errorCode: 'AGENT_ID_REQUIRED', errorMessage: 'AGENT 执行器缺少 agentId/executionTargetId，拒绝伪装成功' };
    const resolved = await this.resolveAgentPayload(input, agentId);
    if (resolved.error) return resolved.error;
    const payload = resolved.payload;
    if (input.dryRun && payload.actionType === 'agent.atomic_plan.execute') {
      return {
        success: true,
        detail: {
          mode: 'agent_atomic_plan_preflight',
          planId: readRecord(payload.plan)?.planId,
          operationCount: Array.isArray(readRecord(payload.plan)?.operations) ? (readRecord(payload.plan)?.operations as unknown[]).length : 0,
        },
      };
    }
    const task = await this.agents.enqueueTask(input.step.tenantId ?? '', {
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      payload,
    }, `execution-step:${input.step.id}`);
    if (this.actionDispatch.resolve(input.step.inputSnapshot)?.mode === 'direct_preferred') {
      try {
        const direct = await this.agents.executeTaskDirect(input.step.tenantId ?? '', task.id, `execution-direct:${input.step.id}`);
        return {
          success: direct.success,
          errorCode: direct.errorCode,
          errorMessage: direct.errorMessage,
          detail: direct.detail,
        };
      } catch (error) {
        const appError = error instanceof AppError ? error : undefined;
        if (!shouldFallbackDirectError(appError)) {
          return {
            success: false,
            errorCode: appError?.errorCode ?? 'DIRECT_EXECUTION_FAILED',
            errorMessage: error instanceof Error ? error.message : String(error),
            detail: {
              mode: 'agent_direct_execute_failed',
              taskId: task.id,
            },
          };
        }
        return {
          success: true,
          asyncPending: true,
          detail: {
            mode: 'agent_task_enqueued',
            taskId: task.id,
            status: task.status,
            directFallback: {
              attempted: true,
              errorCode: appError?.errorCode ?? 'DIRECT_EXECUTION_FAILED',
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          },
        };
      }
    }
    return { success: true, asyncPending: true, detail: { mode: 'agent_task_enqueued', taskId: task.id, status: task.status } };
  }

  private async resolveAgentPayload(input: StepExecutionInput, agentId: string): Promise<{
    payload: Record<string, unknown>;
    error?: undefined;
  } | {
    payload?: undefined;
    error: StepExecutionResult;
  }> {
    const snapshot = input.step.inputSnapshot;
    if (snapshot.actionType !== 'agent.atomic_plan.execute') {
      return { payload: { ...snapshot, stepType: input.step.stepType, runType: input.runType, dryRun: input.dryRun } };
    }
    if (!this.agentPlugins) {
      return { error: { success: false, errorCode: 'AGENT_PLUGIN_SERVICE_REQUIRED', errorMessage: 'Agent 插件执行服务未配置' } };
    }
    const binding = readRecord(snapshot.pluginBinding) as AgentPluginBindingInput | undefined;
    if (!binding) return { error: { success: false, errorCode: 'AGENT_PLUGIN_BINDING_REQUIRED', errorMessage: 'Agent 插件执行缺少绑定快照' } };
    const artifact = readRecord(snapshot.deploymentArtifact) ?? {};
    const artifacts = readRecord(artifact.workflowCertificateMaterials) ?? buildDefaultAgentPluginArtifacts(binding, artifact);
    const plan = await this.agentPlugins.compileExecutionPlan({
      tenantId: input.step.tenantId ?? '',
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      binding,
      artifacts,
      executionMode: input.runType === 'rollback' ? 'ROLLBACK' : input.dryRun ? 'PREFLIGHT' : 'APPLY',
    });
    return { payload: {
        actionType: 'agent.atomic_plan.execute',
        actionSchemaVersion: '1.0',
        plan,
      } };
  }
}

function buildDefaultAgentPluginArtifacts(binding: AgentPluginBindingInput, artifact: Record<string, unknown>): Record<string, unknown> {
  const material = buildWorkflowCertificateMaterial(artifact, {
    expectedCertificateFingerprintSha256: artifact.expectedFingerprintSha256,
  });
  return Object.fromEntries(Object.keys(binding.certificateArtifactBindings ?? {}).map((name) => [name, material]));
}

export class WorkflowExecutorAdapter implements Executor {
  readonly type = 'WORKFLOW';
  private readonly workflows: WorkflowTemplatesApplicationService;
  private readonly curlExecutor: CurlExecutor;
  private readonly sshExecutor: SSHExecutor;
  private readonly stepExecutors: WorkflowStepExecutorRegistry;

  constructor(options: { workflows?: WorkflowTemplatesApplicationService; curlExecutor?: CurlExecutor; sshExecutor?: SSHExecutor } = {}) {
    this.workflows = options.workflows ?? new WorkflowTemplatesApplicationService();
    this.curlExecutor = options.curlExecutor ?? new CurlExecutor();
    this.sshExecutor = options.sshExecutor ?? new SSHExecutor();
    this.stepExecutors = new WorkflowStepExecutorRegistry([
      {
        executorId: '017.CURL_HTTP',
        execute: async (context) => this.executeCurlWorkflowStep(context),
      },
      {
        executorId: '015.SSH',
        execute: async (context) => this.executeSshWorkflowStep(context),
      },
      ...['workflow.condition', 'workflow.transform', 'workflow.wait', 'workflow.manual'].map((executorId) => ({
        executorId,
        execute: async () => ({ success: true, body: { success: true, plannedOnly: true, executor: executorId }, logs: [`workflow:${executorId}:planned`] }),
      })),
    ]);
  }

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const request = readRecord(input.step.inputSnapshot.workflowRequest);
    if (!request) {
      return { success: false, errorCode: 'WORKFLOW_REQUEST_REQUIRED', errorMessage: 'WORKFLOW 执行器缺少 workflowRequest，拒绝伪成功' };
    }
    const workflowVersionId = stringFromSnapshot(request.workflowVersionId);
    if (!workflowVersionId) {
      return { success: false, errorCode: 'WORKFLOW_VERSION_REQUIRED', errorMessage: 'WORKFLOW 执行器缺少 workflowVersionId' };
    }
    const runtimeInput = {
      templateVersionId: workflowVersionId,
      mode: input.dryRun ? 'render_only' as const : 'real_test' as const,
      userVariables: {
        ...(readRecord(request.variableBindings) ?? {}),
        ...(readRecord(request.parameterBindings) ?? {}),
      },
      assetVariables: buildWorkflowAssetVariables(input.step.inputSnapshot, request),
      connectionBindings: (readRecord(request.connectionBindings) ?? {}) as Record<string, WorkflowConnectionBinding>,
      certificateMaterials: buildWorkflowCertificateMaterials(input.step.inputSnapshot),
    };
    try {
      const reportWorkflowProgress = async (workflowProgress: WorkflowRunProgress) => {
        await input.reportProgress?.({
          mode: input.dryRun ? 'workflow_plan' : 'workflow_runner',
          stepType: input.step.stepType,
          workflowProgress,
        });
      };
      const workflowRun = input.dryRun
        ? await this.workflows.preview(runtimeInput, reportWorkflowProgress)
        : await this.workflows.runWithDispatcher(
            runtimeInput,
            async (dispatch) => this.dispatchWorkflowStep(input, dispatch.renderedPlan, dispatch.step.name, dispatch.attempt),
            reportWorkflowProgress,
          );
      const dryRunChecks = input.dryRun ? buildWorkflowDryRunChecks(workflowRun) : undefined;
      const detail = {
        mode: input.dryRun ? 'workflow_plan' : 'workflow_runner',
        workflowRequest: maskWorkflowRequest(request),
        workflowRun,
        ...(dryRunChecks ? {
          dryRunChecks,
          dryRunSummary: summarizeDryRunChecks(dryRunChecks),
        } : {}),
        stepType: input.step.stepType,
      };
      const workflowFailure = workflowRun.status === 'success' ? undefined : summarizeWorkflowFailure(workflowRun);
      return workflowRun.status === 'success'
        ? { success: true, detail: detail as unknown as Record<string, unknown> }
        : {
            success: false,
            errorCode: workflowFailure?.errorCode ?? 'WORKFLOW_RUN_FAILED',
            errorMessage: workflowFailure?.errorMessage ?? '工作流执行失败',
            detail: {
              ...detail,
              failure: workflowFailure,
            } as unknown as Record<string, unknown>,
          };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, errorCode: error.errorCode, errorMessage: error.message, detail: error.details as Record<string, unknown> | undefined };
      }
      return { success: false, errorCode: 'WORKFLOW_RUN_FAILED', errorMessage: error instanceof Error ? error.message : String(error) };
    }
  }

  private async dispatchWorkflowStep(input: StepExecutionInput, renderedPlan: unknown, workflowStepName: string, attempt: number): Promise<WorkflowExecutorDispatchResult> {
    const plan = readRecord(renderedPlan);
    const executor = stringFromSnapshot(plan?.executor);
    return this.stepExecutors.execute(executor, { input, plan, workflowStepName, attempt });
  }

  private async executeCurlWorkflowStep(context: WorkflowStepExecutorContext): Promise<WorkflowExecutorDispatchResult> {
    const childStep = workflowChildStep(context.input.step, `workflow-curl-${context.workflowStepName}-${context.attempt}`, {
      curlRequest: toWorkflowCurlRequest(context.plan, context.input.step, context.workflowStepName, context.attempt),
    });
    if (typeof this.curlExecutor.executeForWorkflow === 'function') {
      const request = childStep.inputSnapshot.curlRequest as CurlExecutionRequest | undefined;
      if (!request) return { success: false, errorCode: 'CURL_REQUEST_REQUIRED', errorMessage: '工作流节点缺少 curlRequest' };
      const execution = await this.curlExecutor.executeForWorkflow(request, false, {
        runId: childStep.executionRunId,
        stepId: childStep.id,
        tenantId: childStep.tenantId,
        actorId: 'curl-executor',
      });
      return curlWorkflowOutput(execution.result, execution.runtimeResponse);
    }
    const result = await this.curlExecutor.executeStep({ ...context.input, step: childStep, dryRun: false });
    return curlWorkflowOutput(result);
  }

  private async executeSshWorkflowStep(context: WorkflowStepExecutorContext): Promise<WorkflowExecutorDispatchResult> {
    const result = await this.sshExecutor.executeStep({
      ...context.input,
      step: workflowChildStep(context.input.step, `workflow-ssh-${context.workflowStepName}-${context.attempt}`, {
        sshRequest: toWorkflowSshRequest(context.plan, context.input.step, context.workflowStepName, context.attempt),
      }),
      dryRun: false,
    });
    return sshWorkflowOutput(result);
  }
}

export interface WorkflowStepExecutorContext {
  input: StepExecutionInput;
  plan: Record<string, unknown> | undefined;
  workflowStepName: string;
  attempt: number;
}

export interface WorkflowStepExecutorRegistration {
  executorId: string;
  execute(context: WorkflowStepExecutorContext): Promise<WorkflowExecutorDispatchResult>;
}

export class WorkflowStepExecutorRegistry {
  private readonly registrations = new Map<string, WorkflowStepExecutorRegistration>();

  constructor(registrations: WorkflowStepExecutorRegistration[] = []) {
    for (const registration of registrations) this.register(registration);
  }

  register(registration: WorkflowStepExecutorRegistration): void {
    const executorId = registration.executorId.trim();
    if (!executorId) throw new AppError('VALIDATION_FAILED', '工作流执行器 ID 不能为空');
    if (this.registrations.has(executorId)) {
      throw new AppError('VALIDATION_FAILED', '工作流执行器重复注册，拒绝静默覆盖', { executorId });
    }
    this.registrations.set(executorId, { ...registration, executorId });
  }

  async execute(executorId: string | undefined, context: WorkflowStepExecutorContext): Promise<WorkflowExecutorDispatchResult> {
    if (!executorId) return { success: false, errorCode: 'WORKFLOW_EXECUTOR_REQUIRED', errorMessage: '工作流节点缺少 executor' };
    const registration = this.registrations.get(executorId);
    if (!registration) {
      return {
        success: false,
        errorCode: 'WORKFLOW_EXECUTOR_NOT_REGISTERED',
        errorMessage: `工作流执行器未注册：${executorId}`,
        body: { executorId, registeredExecutors: this.list() },
      };
    }
    return registration.execute(context);
  }

  list(): string[] {
    return [...this.registrations.keys()].sort();
  }
}

export class GatewayRouteExecutorAdapter implements Executor {
  readonly type = 'GATEWAY_FORWARD';

  private readonly gatewayTasks: GatewayTaskService;
  private readonly agents: AgentsApplicationService;
  private readonly grants: ForwardingGrantService;

  constructor(options: { gatewayTasks?: GatewayTaskService; agents?: AgentsApplicationService; grants?: ForwardingGrantService; auditWriter?: GatewayTaskAuditWriter } = {}) {
    this.gatewayTasks = options.gatewayTasks ?? new GatewayTaskService({ auditWriter: options.auditWriter });
    this.agents = options.agents ?? new AgentsApplicationService();
    this.grants = options.grants ?? new ForwardingGrantService();
  }

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const route = readRecord(input.step.inputSnapshot.gatewayRoute);
    const gatewayId = stringFromSnapshot(input.step.inputSnapshot.gatewayId) ?? stringFromSnapshot(route?.gatewayId) ?? `gw_${input.step.deploymentPlanTargetId ?? 'default'}`;
    const gatewayAgentId = stringFromSnapshot(input.step.inputSnapshot.gatewayAgentId)
      ?? stringFromSnapshot(route?.agentId)
      ?? stringFromSnapshot(route?.gatewayAgentId);
    const delegatedTargetId = stringFromSnapshot(input.step.inputSnapshot.delegatedTargetId) ?? stringFromSnapshot(route?.delegatedTargetId) ?? input.step.deploymentPlanTargetId ?? input.step.id;
    const taskType = gatewayTaskTypeForStep(input.step);
    const routeChannel = gatewayRouteChannel(taskType, input.step.inputSnapshot, route);
    const delegatedAgentId = stringFromSnapshot(input.step.inputSnapshot.targetAgentId)
      ?? stringFromSnapshot(input.step.inputSnapshot.delegatedAgentId)
      ?? stringFromSnapshot(input.step.inputSnapshot.agentId)
      ?? delegatedTargetId;
    const forwardingGrant = this.grants.issue({
      gatewayId,
      delegatedTargetId,
      delegatedAgentId,
      taskType,
      routeChannel,
      executionRunId: input.step.executionRunId,
      stepId: input.step.id,
    });
    const task = this.gatewayTasks.dispatch({
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      tenantId: input.step.tenantId,
      planId: stringFromSnapshot(input.step.inputSnapshot.deploymentPlanId),
      executionRunId: input.step.executionRunId,
      stepId: input.step.id,
      gatewayId,
      delegatedTargetId,
      target: { id: delegatedTargetId, zoneId: stringFromSnapshot(input.step.inputSnapshot.zoneId) ?? stringFromSnapshot(route?.zoneId) ?? 'default' },
      adapter: routeChannel,
      action: taskType,
      payload: buildGatewayRoutePayload(input, taskType, delegatedTargetId, delegatedAgentId, forwardingGrant.id),
      forwardingGrant,
    });

    if (!gatewayAgentId) {
      return {
        success: false,
        errorCode: 'GATEWAY_AGENT_ID_REQUIRED',
        errorMessage: 'Gateway 路由必须指定 gatewayRoute.agentId/gatewayAgentId，拒绝在控制面本地伪执行',
        detail: { mode: 'gateway_route_dispatch_failed', gatewayId, taskId: task.id, taskType },
      };
    }

    const agentTask = await this.agents.enqueueTask(input.step.tenantId ?? '', {
      agentId: gatewayAgentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      idempotencyKey: task.idempotencyKey,
      payload: {
        type: taskType,
        gatewayTask: task,
        runType: input.runType,
        dryRun: input.dryRun,
      },
    }, `gateway-execution-step:${input.step.id}`);

    return {
      success: true,
      asyncPending: true,
      detail: {
        mode: 'gateway_route_task_enqueued',
        gatewayTaskId: task.id,
        agentTaskId: agentTask.id,
        gatewayId,
        gatewayAgentId,
        delegatedTargetId,
        delegatedAgentId,
        forwardingGrantId: forwardingGrant.id,
        taskType,
        routeChannel,
        status: agentTask.status,
      },
    };
  }
}

export class LegacyAgentExecutorAdapter implements Executor {
  readonly type = 'SCRIPT_PACKAGE';

  constructor(private readonly translator = new LegacyTaskTranslator(), private readonly dispatcher = new LegacyTaskDispatcher()) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const profile = readRecord(input.step.inputSnapshot.legacyProfile) as LegacyAgentProfile | undefined;
    const legacyStep = readRecord(input.step.inputSnapshot.legacyStep) as UnifiedLegacyStep | undefined;
    if (!profile || !legacyStep) {
      return { success: true, detail: { mode: 'legacy_mock_safe_adapter', reason: '未提供 legacyProfile/legacyStep，仅生成可审计的 mock-safe 占位结果，不执行真实协议', dryRun: input.dryRun } };
    }
    const translation = this.translator.translate(profile, legacyStep);
    if (translation.mode === 'legacy_task' && translation.legacyTask) {
      const record = this.dispatcher.dispatch(profile, translation.legacyTask);
      return { success: true, detail: { mode: translation.mode, taskRecordId: record.id, status: record.status, gate: translation.gate } };
    }
    if (translation.mode === 'script_package_plan' && translation.scriptPackagePlan) {
      return { success: true, detail: { mode: translation.mode, scriptPackagePlan: translation.scriptPackagePlan, gate: translation.gate } };
    }
    return { success: false, errorCode: 'LEGACY_EXECUTOR_MANUAL_REQUIRED', errorMessage: 'Legacy 执行器需要人工结果或监控模式，不能自动判定成功', detail: { mode: translation.mode, gate: translation.gate } };
  }
}

export class ControlPlaneTlsExecutor implements Executor {
  readonly type = 'CONTROL_PLANE_TLS';

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    if (input.dryRun) {
      return {
        success: true,
        detail: {
          mode: 'control_plane_tls_verify_skipped',
          reason: 'dry-run 阶段只检查验证目标是否可构造，不发起真实 TLS 连接',
        },
      };
    }
    const target = buildControlPlaneTlsTarget(input.step.inputSnapshot);
    if (!target) {
      return {
        success: false,
        errorCode: 'TLS_VERIFY_TARGET_UNRESOLVED',
        errorMessage: '控制面 VERIFY 缺少可访问的验证目标，无法发起真实 TLS 验证',
        detail: { mode: 'control_plane_tls_verify_failed' },
      };
    }
    try {
      const report = await probeTlsCertificate(target);
      const expectedDomains = readStringArray(input.step.inputSnapshot.expectedDomains);
      for (const domain of expectedDomains) {
        const normalized = domain.trim().toLowerCase();
        if (!normalized) continue;
        if (!certificateMatchesDomain(report, normalized)) {
          return {
            success: false,
            errorCode: 'TLS_VERIFY_DOMAIN_MISMATCH',
            errorMessage: `控制面 VERIFY 发现远端 TLS 证书域名不匹配: ${domain}`,
            detail: {
              mode: 'control_plane_tls_verify_failed',
              verify: report,
              expectedDomains,
            },
          };
        }
      }
      return {
        success: true,
        detail: {
          mode: 'control_plane_tls_verify',
          executor: this.type,
          verify: report,
          newThumbprint: report.remoteThumbprint,
        },
      };
    } catch (error) {
      return {
        success: false,
        errorCode: 'TLS_VERIFY_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        detail: {
          mode: 'control_plane_tls_verify_failed',
          target,
        },
      };
    }
  }
}

function stringFromSnapshot(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function readNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildControlPlaneTlsTarget(snapshot: Record<string, unknown>): TlsVerifyTarget | undefined {
  const verifyUrl = stringFromSnapshot(snapshot.verifyUrl);
  if (verifyUrl) return buildTlsVerifyTargetFromUrl(verifyUrl);

  const policy = readRecord(snapshot.executionPolicy);
  const selector = readRecord(snapshot.bindingSelector);
  const host = stringFromSnapshot(policy?.verifyHost)
    ?? stringFromSnapshot(selector?.hostHeader)
    ?? stringFromSnapshot(selector?.serverName);
  const port = readNumberValue(policy?.verifyPort) ?? readNumberValue(selector?.port) ?? readNumberValue(selector?.listenPort) ?? 443;
  if (!host || !port) return undefined;
  return {
    host,
    port,
    serverName: stringFromSnapshot(policy?.hostHeader) ?? host,
    target: `https://${host}:${port}`,
  };
}

function maskWorkflowRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskWorkflowRequest);
  const record = readRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [
    key,
    /(password|token|privateKey|secret|credential|pfx|jks)/i.test(key) ? '[REDACTED]' : maskWorkflowRequest(child),
  ]));
}

type DryRunCheckStatus = 'passed' | 'warning' | 'failed' | 'unknown';

interface DryRunCheck {
  key: string;
  label: string;
  status: DryRunCheckStatus;
  detail: string;
  evidence?: Record<string, unknown>;
}

function buildWorkflowDryRunChecks(workflowRun: WorkflowRunResult): DryRunCheck[] {
  const checks = workflowRun.renderedSteps.map((step, index) => {
    const preview = readRecord(step.preview) ?? readRecord(step.request);
    const executor = stringFromSnapshot(preview?.executor) ?? (step.type === 'wait' ? 'workflow.wait' : `workflow.${step.type}`);
    const status: DryRunCheckStatus = step.skipped ? 'warning' : 'passed';
    return {
      key: `workflow_step_${index + 1}_${step.name}`,
      label: `工作流节点预览：${step.name}`,
      status,
      detail: step.skipped
        ? `节点被条件跳过：${step.reason ?? 'condition_not_matched'}`
        : buildWorkflowDryRunCheckDetail(step, preview),
      evidence: {
        workflowRunId: workflowRun.id,
        plannedOnly: workflowRun.plannedOnly,
        stage: step.stage,
        type: step.type,
        executor,
        skipped: step.skipped === true,
      },
    };
  });
  if (checks.length > 0) return checks;
  return [{
    key: 'workflow_plan_empty',
    label: '工作流计划预览',
    status: 'unknown',
    detail: '工作流 dry-run 已完成，但没有渲染出可检查的节点。',
    evidence: { workflowRunId: workflowRun.id, plannedOnly: workflowRun.plannedOnly, status: workflowRun.status },
  }];
}

function buildWorkflowDryRunCheckDetail(
  step: WorkflowRunResult['renderedSteps'][number],
  preview: Record<string, unknown> | undefined,
): string {
  const stage = stageLabel(step.stage);
  const executor = stringFromSnapshot(preview?.executor);
  if (executor === '017.CURL_HTTP') {
    const curlRequest = readRecord(preview?.curlRequest);
    const template = readRecord(curlRequest?.template);
    const responsePolicy = readRecord(curlRequest?.responsePolicy);
    const method = stringFromSnapshot(template?.method) ?? 'HTTP';
    const url = stringFromSnapshot(template?.url) ?? '未解析地址';
    const assertionCount = Array.isArray(responsePolicy?.assertions) ? responsePolicy.assertions.length : 0;
    const extractorCount = Array.isArray(curlRequest?.extractors) ? curlRequest.extractors.length : 0;
    return `${stage}阶段请求已解析：${method} ${url}；响应策略包含 ${assertionCount} 项断言、${extractorCount} 项变量提取，未发送真实请求。`;
  }
  if (executor === '015.SSH') {
    const connection = readRecord(preview?.connection) ?? readRecord(readRecord(preview?.sshRequest)?.connection);
    const host = stringFromSnapshot(connection?.host) ?? '未解析主机';
    const protocol = stringFromSnapshot(preview?.protocol);
    return protocol
      ? `${stage}阶段 ${protocol.toUpperCase()} 文件传输计划已解析，目标 ${host}；未建立真实 SSH 连接或写入文件。`
      : `${stage}阶段 SSH 执行计划已解析，目标 ${host}；连接参数和命令结构有效，未建立真实 SSH 连接。`;
  }
  if (executor === 'workflow.transform') {
    const outputNames = readStringArray(preview?.outputNames);
    return `${stage}阶段数据转换已通过结构校验，将生成 ${outputNames.length} 个上下文变量；dry-run 不执行实际转换。`;
  }
  if (executor === 'workflow.condition') {
    return `${stage}阶段条件表达式已解析，当前预检结果为${preview?.passed === true ? '满足' : '不满足'}。`;
  }
  if (executor === 'workflow.wait') {
    return `${stage}阶段等待节点配置有效；dry-run 不执行实际等待。`;
  }
  if (executor === 'workflow.manual') {
    return `${stage}阶段人工操作说明已解析；正式执行前仍需人工确认。`;
  }
  return `${stage}阶段的 ${step.type.toUpperCase()} 节点已完成变量和执行计划校验，dry-run 不执行真实变更。`;
}

function summarizeDryRunChecks(checks: readonly DryRunCheck[]): Record<DryRunCheckStatus, number> {
  return checks.reduce<Record<DryRunCheckStatus, number>>((summary, check) => {
    summary[check.status] += 1;
    return summary;
  }, { passed: 0, warning: 0, failed: 0, unknown: 0 });
}

function summarizeWorkflowFailure(workflowRun: WorkflowRunResult): { errorCode: string; errorMessage: string; stepName?: string; stage?: string; type?: string; rolledBack?: boolean } {
  const failedStep = workflowRun.stepResults.find((step) => step.status === 'failed')
    ?? workflowRun.rollbackResults.find((step) => step.status === 'failed');
  if (!failedStep) {
    return {
      errorCode: workflowRun.status === 'rolled_back' ? 'WORKFLOW_ROLLED_BACK' : 'WORKFLOW_RUN_FAILED',
      errorMessage: workflowRun.status === 'rolled_back' ? '工作流执行失败并已触发回滚' : '工作流执行失败',
      rolledBack: workflowRun.status === 'rolled_back',
    };
  }
  return {
    errorCode: failedStep.errorCode ?? 'WORKFLOW_STEP_FAILED',
    errorMessage: `工作流节点 ${failedStep.name} 失败：${failedStep.errorMessage ?? failedStep.errorCode ?? '未返回具体错误'}`,
    stepName: failedStep.name,
    stage: failedStep.stage,
    type: failedStep.type,
    rolledBack: workflowRun.status === 'rolled_back',
  };
}

function stageLabel(stage: string | undefined): string {
  if (stage === 'prepare') return '准备';
  if (stage === 'backup') return '备份';
  if (stage === 'install') return '安装';
  if (stage === 'refresh') return '刷新';
  if (stage === 'verify') return '验证';
  return '未分阶段';
}

function workflowChildStep(parent: ExecutionStepEntity, suffix: string, inputSnapshot: Record<string, unknown>): ExecutionStepEntity {
  return {
    ...parent,
    id: `${parent.id}:${suffix}`,
    inputSnapshot,
  };
}

function buildWorkflowAssetVariables(snapshot: Record<string, unknown>, request: Record<string, unknown>): Record<string, unknown> {
  const target = readRecord(request.target) ?? {};
  return {
    applicationAssetId: request.applicationAssetId,
    managedTargetId: request.managedTargetId,
    siteAssetId: request.siteAssetId,
    certificateBindingId: request.certificateBindingId ?? snapshot.certificateBindingId,
    deploymentPlanId: snapshot.deploymentPlanId,
    deploymentPlanTargetId: snapshot.deploymentPlanTargetId,
    target,
    frameworkType: target.frameworkType,
    siteName: target.siteName,
    bindingInformation: target.bindingInformation,
    hostHeader: target.hostHeader,
    port: target.port,
    protocol: target.protocol,
    verifyUrl: target.verifyUrl ?? snapshot.verifyUrl,
    sniName: target.sniName,
  };
}

function buildWorkflowCertificateMaterials(snapshot: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const artifact = readRecord(snapshot.deploymentArtifact) ?? readRecord(snapshot.artifact);
  if (!artifact) return {};
  const declaredMaterials = readRecord(artifact.workflowCertificateMaterials);
  if (declaredMaterials) {
    const materials = Object.fromEntries(
      Object.entries(declaredMaterials)
        .map(([name, value]) => {
          const material = readRecord(value);
          return material ? [name, normalizeWorkflowCertificateMaterial(material, snapshot)] as const : undefined;
        })
        .filter((item): item is readonly [string, Record<string, unknown>] => Boolean(item)),
    );
    if (Object.keys(materials).length > 0) return materials;
  }
  const material = buildWorkflowCertificateMaterial(artifact, snapshot);
  const aliases = readStringArray(artifact.variableAliases);
  const names = new Set(['certificate', 'cert', ...aliases]);
  return Object.fromEntries([...names].map((name) => [name, material]));
}

function buildWorkflowCertificateMaterial(artifact: Record<string, unknown>, snapshot: Record<string, unknown>): Record<string, unknown> {
  return normalizeWorkflowCertificateMaterial({
    pem: artifact.certificatePem,
    certificatePem: artifact.certificatePem,
    privateKey: artifact.privateKeyPem,
    privateKeyPem: artifact.privateKeyPem,
    pfx: artifact.pfxBase64,
    pfxBase64: artifact.pfxBase64,
    pfxPassword: artifact.pfxPassword,
    fingerprintSha256: artifact.expectedFingerprintSha256 ?? snapshot.expectedCertificateFingerprintSha256,
    files: normalizeWorkflowCertificateFiles(artifact),
  }, snapshot);
}

function normalizeWorkflowCertificateMaterial(material: Record<string, unknown>, snapshot: Record<string, unknown>): Record<string, unknown> {
  const files = normalizeWorkflowCertificateFiles(material);
  const existingOutputs = readRecord(material.outputs);
  return {
    ...material,
    fingerprintSha256: material.fingerprintSha256 ?? material.expectedFingerprintSha256 ?? snapshot.expectedCertificateFingerprintSha256,
    files,
    outputs: existingOutputs && Object.keys(existingOutputs).length > 0
      ? existingOutputs
      : buildWorkflowCertificateOutputs(files),
  };
}

function normalizeWorkflowCertificateFiles(artifact: Record<string, unknown>): Array<Record<string, unknown>> {
  const declared = Array.isArray(artifact.files)
    ? artifact.files.filter((item): item is Record<string, unknown> => Boolean(readRecord(item)))
    : [];
  if (declared.length > 0) return declared;
  const files: Array<Record<string, unknown>> = [];
  const certificatePem = stringFromSnapshot(artifact.certificatePem);
  const privateKeyPem = stringFromSnapshot(artifact.privateKeyPem);
  const pfxBase64 = stringFromSnapshot(artifact.pfxBase64);
  if (certificatePem) {
    files.push({
      name: 'certificate',
      role: 'public_certificate',
      format: 'pem',
      content: certificatePem,
      contentEncoding: 'utf8',
    });
  }
  if (privateKeyPem) {
    files.push({
      name: 'privateKey',
      role: 'private_key',
      format: 'pem',
      content: privateKeyPem,
      contentEncoding: 'utf8',
    });
  }
  if (pfxBase64) {
    files.push({
      name: 'bundle',
      role: 'bundle',
      format: 'pfx',
      contentBase64: pfxBase64,
      contentEncoding: 'base64',
    });
  }
  return files;
}

function buildWorkflowCertificateOutputs(files: Array<Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const file of files) {
    const key = stringFromSnapshot(file.key) ?? stringFromSnapshot(file.name);
    if (key) outputs[key] = file;
    const role = stringFromSnapshot(file.role);
    if (role === 'public_certificate') outputs.certFile ??= file;
    if (role === 'private_key') outputs.keyFile ??= file;
    if (role === 'certificate_chain') outputs.chainFile ??= file;
    if (role === 'bundle') outputs.bundleFile ??= file;
  }
  return outputs;
}

function toWorkflowSshRequest(plan: Record<string, unknown> | undefined, parent: ExecutionStepEntity, stepName: string, attempt: number): Record<string, unknown> {
  const connection = readRecord(plan?.connection);
  const command = stringFromSnapshot(plan?.command);
  const timeoutMs = typeof plan?.timeoutMs === 'number' ? plan.timeoutMs : undefined;
  const directRequest = readRecord(plan?.sshRequest);
  return {
    ...(directRequest ?? {}),
    idempotencyKey: `${parent.executionRunId}:${parent.id}:workflow-ssh:${stepName}:${attempt}`,
    connection,
    command,
    commands: readStringArray(plan?.commands),
    script: stringFromSnapshot(plan?.script),
    timeoutMs,
    dryRun: false,
  };
}

function toWorkflowCurlRequest(plan: Record<string, unknown> | undefined, parent: ExecutionStepEntity, stepName: string, attempt: number): Record<string, unknown> | undefined {
  const directRequest = readRecord(plan?.curlRequest);
  if (!directRequest) return undefined;
  return {
    ...directRequest,
    idempotencyKey: `${parent.executionRunId}:${parent.id}:workflow-curl:${stepName}:${attempt}`,
    dryRun: false,
  };
}

function curlWorkflowOutput(result: StepExecutionResult): WorkflowExecutorDispatchResult;
function curlWorkflowOutput(result: CurlExecutionResult, runtimeResponse?: HttpResponse): WorkflowExecutorDispatchResult;
function curlWorkflowOutput(result: StepExecutionResult | CurlExecutionResult, runtimeResponse?: HttpResponse): WorkflowExecutorDispatchResult {
  if ('rendered' in result) {
    return {
      success: result.success,
      statusCode: runtimeResponse?.statusCode ?? result.statusCode ?? (result.success ? 200 : 500),
      headers: runtimeResponse?.headers ?? result.headers,
      body: runtimeResponse?.bodyJson ?? runtimeResponse?.body ?? runtimeResponse?.bodyText ?? result.bodyJson ?? result.bodyText,
      stdout: runtimeResponse?.bodyText ?? (runtimeResponse?.bodyJson === undefined ? result.bodyText : JSON.stringify(runtimeResponse.bodyJson)),
      logs: ['curl:runner:control_plane', ...result.logs],
      raw: result,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  }
  const detail = readRecord(result.detail);
  const response = readRecord(detail?.response) ?? detail;
  return {
    success: result.success,
    statusCode: typeof response?.statusCode === 'number' ? response.statusCode : result.success ? 200 : 500,
    headers: readRecord(response?.headers) as Record<string, string> | undefined,
    body: response?.bodyJson ?? response?.bodyText ?? detail,
    stdout: typeof response?.bodyText === 'string' ? response.bodyText : JSON.stringify(response?.bodyJson ?? detail ?? {}),
    logs: ['curl:runner:control_plane', ...readStringArray(detail?.logs)],
    raw: detail,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

function sshWorkflowOutput(result: StepExecutionResult): WorkflowExecutorDispatchResult {
  const detail = readRecord(result.detail);
  const commandResult = readRecord(detail?.commandResult);
  return {
    success: result.success,
    exitCode: typeof commandResult?.exitCode === 'number' ? commandResult.exitCode : result.success ? 0 : 1,
    stdout: typeof commandResult?.stdout === 'string' ? commandResult.stdout : '',
    body: detail,
    logs: readStringArray(commandResult?.logs),
    raw: detail,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

function shouldFallbackDirectError(error: AppError | undefined): boolean {
  return error?.errorCode === 'EXECUTION_TARGET_UNAVAILABLE'
    || error?.errorCode === 'CAPABILITY_MISSING'
    || error?.errorCode === 'VALIDATION_FAILED';
}

function gatewayTaskTypeForStep(step: ExecutionStepEntity): 'gateway.probe' | 'gateway.forward.agent_task' | 'gateway.forward.direct_control' {
  const explicit = stringFromSnapshot(step.inputSnapshot.gatewayTaskType);
  if (explicit === 'gateway.probe' || explicit === 'gateway.forward.agent_task' || explicit === 'gateway.forward.direct_control') return explicit;
  const forwardMode = stringFromSnapshot(step.inputSnapshot.gatewayForwardMode);
  if (forwardMode === 'direct_control') return 'gateway.forward.direct_control';
  if (step.stepType === 'DISCOVER' || step.stepType === 'VERIFY') return 'gateway.probe';
  return 'gateway.forward.agent_task';
}

function gatewayRouteChannel(taskType: string, snapshot: Record<string, unknown>, route: Record<string, unknown> | undefined): string {
  const explicit = stringFromSnapshot(snapshot.gatewayRouteChannel) ?? stringFromSnapshot(snapshot.gatewayAdapter) ?? stringFromSnapshot(route?.adapter);
  if (explicit) return normalizeGatewayRouteChannel(explicit, taskType);
  if (taskType === 'gateway.probe') return 'probe.tcp';
  if (taskType === 'gateway.forward.direct_control') return 'forward.direct_control';
  return 'forward.agent_task';
}

function normalizeGatewayRouteChannel(value: string, taskType: string): string {
  const normalized = value.trim().toLowerCase();
  if (['http', 'https', 'curl', 'probe.http'].includes(normalized)) return 'probe.http';
  if (['tcp', 'tls', 'probe.tcp'].includes(normalized)) return 'probe.tcp';
  if (['agent', 'probe.agent'].includes(normalized)) return 'probe.agent';
  if (['direct_control', 'forward.direct_control', 'gateway.forward.direct_control'].includes(normalized)) return 'forward.direct_control';
  if (['agent_task', 'forward.agent_task', 'gateway.forward.agent_task'].includes(normalized)) return 'forward.agent_task';
  if (taskType === 'gateway.probe') return 'probe.tcp';
  return 'forward.agent_task';
}

function buildGatewayRoutePayload(input: StepExecutionInput, taskType: string, delegatedTargetId: string, delegatedAgentId: string | undefined, forwardingGrantId: string): Record<string, unknown> {
  const snapshot = input.step.inputSnapshot;
  return {
    type: taskType,
    delegatedTargetId,
    delegatedAgentId,
    targetAgentId: delegatedAgentId,
    forwardingGrantId,
    dryRun: input.dryRun,
    runType: input.runType,
    stepType: input.step.stepType,
    executionRunId: input.step.executionRunId,
    executionStepId: input.step.id,
    targetPayload: maskWorkflowRequest(snapshot),
  };
}
