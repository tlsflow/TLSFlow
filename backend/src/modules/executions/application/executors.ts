import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import { ForwardingGrantService } from '../../gateway-agents/forwarding-grant.service.js';
import type { GatewayTaskAuditWriter } from '../../gateway-agents/gateway-target-history.service.js';
import { GatewayTaskService } from '../../gateway-agents/gateway-task.service.js';
import type { GatewayGrantV1 } from '../../gateway-agents/gateway-agent.types.js';
import { CurlExecutor, SSHExecutor, type CurlExecutionRequest, type CurlExecutionResult, type HttpResponse } from '../../executors/index.js';
import { SecretServiceCurlResolver } from '../../executors/curl/curl.secret-resolver.js';
import { SecretServiceSshResolver } from '../../executors/ssh/ssh.secret-resolver.js';
import { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowExecutorDispatchResult, WorkflowRunProgress, WorkflowRunResult } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';
import { AgentActionDispatchRegistry, type AgentActionDispatchResolution } from './agent-action-dispatch-registry.js';
import type { UnifiedAgentPlanCompilerService } from '../../plugins/application/unified-agent-plan-compiler.service.js';
import { readResolvedDeploymentInputV1 } from '../../deployment-inputs/schema/resolved-deployment-input.schema.js';
import type { DeploymentAssetContextV1 } from '../../deployment-inputs/dto/deployment-asset-context.dto.js';
import { buildTlsVerifyTargetFromUrl, evaluateTlsVerification, probeTlsCertificate, type TlsVerifyTarget } from './tls-verification.js';
import { WorkflowRecoveryLedgerService, type WorkflowRecoveryLedgerRecord } from './workflow-recovery-ledger.service.js';
import { PluginResourceLockService, type PluginResourceLockRecord } from './plugin-resource-lock.service.js';
import { projectWorkflowBusinessSteps } from './workflow-business-step-projector.js';
import type { ExecutionGrantService } from '../execution-grant.service.js';
import { enrichWorkflowCertificateMaterial } from '../../certificates/artifacts/workflow-certificate-material.js';
import {
  createDefaultPluginRunnerExecutionDependencies,
  createPluginRunnerExecutors,
  type PluginRunnerExecutionDependencies,
} from './plugin-runner-executor.adapter.js';

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

export class PlatformStageExecutor implements Executor {
  readonly type = 'PLATFORM_STAGE';

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const stage = input.step.stepType;
    if (stage !== 'DISCOVER' && stage !== 'BACKUP' && stage !== 'RELOAD') {
      return {
        success: false,
        errorCode: 'PLATFORM_STAGE_UNSUPPORTED',
        errorMessage: `Unsupported platform lifecycle stage: ${stage}`,
      };
    }
    return {
      success: true,
      detail: {
        mode: 'platform_certificate_lifecycle',
        stage,
        dryRun: input.dryRun,
        operation: stage === 'DISCOVER'
          ? 'prepare_certificate_update'
          : stage === 'BACKUP'
            ? 'prepare_recovery_checkpoint'
            : 'confirm_service_reload',
      },
    };
  }
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
  agentPlanCompiler?: UnifiedAgentPlanCompilerService;
  workflowRecovery?: WorkflowRecoveryLedgerService;
  pluginResourceLocks?: PluginResourceLockService;
  executionGrants?: ExecutionGrantService;
  pluginRunner?: PluginRunnerExecutionDependencies;
}

export class ExecutorRegistry {
  private readonly executors = new Map<string, Executor>();
  private readonly allowMock: boolean;

  constructor(executors: Executor[] = createDefaultExecutors(), options: ExecutorRegistryOptions = {}) {
    this.allowMock = options.allowMock ?? false;
    for (const executor of executors) this.register(executor);
    if (!this.executors.has('PLATFORM_STAGE')) this.register(new PlatformStageExecutor());
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
  const curlExecutor = new CurlExecutor({
    ...(dependencies.secrets ? { secretResolver: new SecretServiceCurlResolver(dependencies.secrets) } : {}),
    ...(dependencies.executionGrants ? { executionGrantService: dependencies.executionGrants } : {}),
  });
  const pluginRunner = {
    ...(dependencies.pluginRunner ?? createDefaultPluginRunnerExecutionDependencies()),
    ...(dependencies.executionGrants ? { executionGrants: dependencies.executionGrants } : {}),
  };
  // Runner 只接受已固定的 PLUGIN_RUNNER 绑定，不复用 Agent、Workflow 或 Trusted JS 类型。
  const pluginRunnerExecutors = createPluginRunnerExecutors(pluginRunner);
  // Agent v2 只有在控制面同时提供 Agent 服务和统一 Plan 编译器时才注册；依赖缺失时保持未注册并失败关闭。
  const agentExecutor = dependencies.agents && dependencies.agentPlanCompiler
    ? [new AgentExecutorAdapter(dependencies.agents, undefined, dependencies.agentPlanCompiler)]
    : [];
  return [
    ...agentExecutor,
    sshExecutor,
    curlExecutor,
    new WorkflowExecutorAdapter({
      workflows: dependencies.workflows,
      curlExecutor,
      sshExecutor,
      recovery: dependencies.workflowRecovery,
      resourceLocks: dependencies.pluginResourceLocks,
      executionGrants: dependencies.executionGrants,
    }),
    ...pluginRunnerExecutors,
    new GatewayRouteExecutorAdapter({ agents: dependencies.agents, gatewayTasks: dependencies.gatewayTasks, auditWriter: dependencies.gatewayTaskAuditWriter, agentPlanCompiler: dependencies.agentPlanCompiler }),
    new ControlPlaneTlsExecutor(),
  ];
}

function normalizeExecutorType(type: string): string {
  return type.trim().toUpperCase();
}

export class AgentExecutorAdapter implements Executor {
  readonly type = 'AGENT';

  constructor(
    private readonly agents = new AgentsApplicationService(),
    private readonly actionDispatch = new AgentActionDispatchRegistry(),
    private readonly agentPlanCompiler?: UnifiedAgentPlanCompilerService,
  ) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const planAgentId = stringFromSnapshot(readRecord(input.step.inputSnapshot.plan)?.agentId);
    const agentId = stringFromSnapshot(input.step.inputSnapshot.agentId)
      ?? planAgentId
      ?? stringFromSnapshot(input.step.inputSnapshot.executionTargetId)
      ?? stringFromSnapshot(input.step.inputSnapshot.deploymentPlanTargetId);
    if (!agentId) return { success: false, errorCode: 'AGENT_ID_REQUIRED', errorMessage: 'AGENT 执行器缺少 agentId/executionTargetId，拒绝伪装成功' };
    const requiredAction = this.actionDispatch.requireResolution(input.step.inputSnapshot);
    if (!requiredAction.ok) {
      return {
        success: false,
        errorCode: requiredAction.errorCode,
        errorMessage: requiredAction.errorCode === 'AGENT_ACTION_SCHEMA_UNSUPPORTED' ? 'Agent Action Schema 版本不受支持' : 'Agent Action 未注册，拒绝入队',
        detail: requiredAction.requestedActionType ? { requestedActionType: requiredAction.requestedActionType } : undefined,
      };
    }
    const dispatch = requiredAction.resolution;
    const resolved = await this.resolveAgentPayload(input, agentId, dispatch);
    if (resolved.error) return resolved.error;
    return this.executeResolvedPayload(input, agentId, resolved.payload, dispatch);
  }

  private async executeResolvedPayload(input: StepExecutionInput, agentId: string, payload: Record<string, unknown>, dispatch: AgentActionDispatchResolution): Promise<StepExecutionResult> {
    const tenantId = requireExecutionTenantId(input.step, 'agent v2 task queue');
    const task = await this.agents.enqueueTask(tenantId, {
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      payload,
    }, `execution-step:${input.step.id}`);
    return {
      success: true,
      asyncPending: true,
      detail: {
        mode: 'agent_v2_control_plane_queue',
        dispatchMode: dispatch.mode,
        taskId: task.id,
        actionType: dispatch.actionType,
      },
    };
  }

  private async resolveAgentPayload(input: StepExecutionInput, agentId: string, dispatch: AgentActionDispatchResolution): Promise<{
    payload: Record<string, unknown>;
    error?: undefined;
  } | {
    payload?: undefined;
    error: StepExecutionResult;
  }> {
    const snapshot = input.step.inputSnapshot;
    const actionType = resolveAgentActionType(input, dispatch.actionType);
    if (!actionType) {
      return { error: { success: false, errorCode: 'AGENT_V2_ACTION_MODE_MISMATCH', errorMessage: 'Agent v2 Action 与执行模式不匹配' } };
    }
    if (actionType !== 'agent.plan.validate' && actionType !== 'agent.plan.execute') {
      return { payload: buildRegisteredAgentPayload(snapshot, input) };
    }
    if (!this.agentPlanCompiler) {
      return { error: { success: false, errorCode: 'AGENT_PLUGIN_SERVICE_REQUIRED', errorMessage: '统一 Agent Plan 编译器未配置' } };
    }
    const runtimeCapability = readRecord(snapshot.pluginRuntimeCapability);
    const executionSource = readRecord(snapshot.executionSource);
    const pluginBindingId = stringFromSnapshot(snapshot.pluginBindingId)
      ?? stringFromSnapshot(runtimeCapability?.pluginBindingId)
      ?? stringFromSnapshot(executionSource?.pluginBindingId);
    if (!pluginBindingId) return { error: { success: false, errorCode: 'AGENT_PLUGIN_BINDING_REQUIRED', errorMessage: 'Agent 插件执行缺少统一 Binding ID' } };
    const pluginVersionId = stringFromSnapshot(runtimeCapability?.pluginVersionId)
      ?? stringFromSnapshot(executionSource?.pluginVersionId)
      ?? stringFromSnapshot(snapshot.pluginVersionId);
    if (!pluginVersionId) return { error: { success: false, errorCode: 'VALIDATION_FAILED', errorMessage: 'Agent 插件执行缺少固定 PluginVersion' } };
    const resolvedInput = readResolvedDeploymentInputV1(snapshot.resolvedDeploymentInput);
    if (!resolvedInput) return { error: { success: false, errorCode: 'VALIDATION_FAILED', errorMessage: 'Agent 执行缺少统一部署输入快照' } };
    const plan = await this.agentPlanCompiler.compile({
      tenantId: requireExecutionTenantId(input.step, 'agent plan compile'),
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      pluginVersionId,
      pluginBindingId,
      resolvedInput,
      executionMode: input.runType === 'rollback' ? 'ROLLBACK' : input.dryRun ? 'PREFLIGHT' : 'APPLY',
      v2Request: {
        actionType,
        plan: snapshot.plan,
        authorization: readAgentPlanAuthorization(snapshot.executionAuthorization),
      },
    });
    if (plan.actionType !== actionType) {
      return { error: { success: false, errorCode: 'AGENT_V2_ACTION_MODE_MISMATCH', errorMessage: 'Agent v2 编译结果与执行模式不匹配' } };
    }
    return { payload: buildAgentV2ControlPayload({
      actionType: plan.actionType,
      actionSchemaVersion: '1.0',
      plan: plan.plan,
      token: plan.token,
      policyDecision: plan.policyDecision,
    }, input) };
  }
}

function resolveAgentActionType(input: StepExecutionInput, actionType: string): 'agent.fact.collect' | 'agent.plan.validate' | 'agent.plan.execute' | 'agent.execution.receipt' | undefined {
  if (input.dryRun && actionType === 'agent.plan.execute') return 'agent.plan.validate';
  if (actionType === 'agent.fact.collect' || actionType === 'agent.plan.validate' || actionType === 'agent.plan.execute' || actionType === 'agent.execution.receipt') {
    return actionType;
  }
  return undefined;
}

function buildRegisteredAgentPayload(snapshot: Record<string, unknown>, input: StepExecutionInput): Record<string, unknown> {
  return {
    ...buildAgentV2ControlPayload(snapshot, input),
    stepType: input.step.stepType,
    runType: input.runType,
    dryRun: input.dryRun,
  };
}

/**
 * 控制面入队的唯一 Agent v2 载荷形状。
 * Go Agent 不应猜测宿主上下文；所有授权绑定字段在入队时一次性固定。
 */
function buildAgentV2ControlPayload(snapshot: Record<string, unknown>, input: StepExecutionInput): Record<string, unknown> {
  const actionType = requireGatewayActionType(snapshot.actionType);
  const token = requireRecord(snapshot.token, 'AgentCapabilityTokenV1');
  const policyDecision = requireRecord(snapshot.policyDecision, 'PolicyAuthorityDecisionV1');
  const plan = readRecord(snapshot.plan);
  const receipt = readRecord(snapshot.receipt);
  if ((actionType === 'agent.plan.validate' || actionType === 'agent.plan.execute') && !plan) {
    throw new AppError('VALIDATION_FAILED', 'Agent v2 Plan 缺失，拒绝入队');
  }
  if (actionType === 'agent.execution.receipt' && !receipt) {
    throw new AppError('VALIDATION_FAILED', 'Agent v2 Receipt 缺失，拒绝入队');
  }
  const agentId = requireStringValue(token.agentId, 'agentId');
  const tenantId = requireStringValue(token.tenantId, 'tenantId');
  const pluginId = requireStringValue(token.pluginId, 'pluginId');
  const pluginVersionId = requireStringValue(token.pluginVersionId, 'pluginVersionId');
  const capability = requireStringValue(token.capability, 'capability');
  const planDigest = requireStringValue(token.planDigest, 'planDigest');
  return {
    action: actionType,
    actionType,
    actionSchemaVersion: stringFromSnapshot(snapshot.actionSchemaVersion) ?? '1.0',
    requestId: stringFromSnapshot(snapshot.requestId) ?? `execution:${input.step.executionRunId}:${input.step.id}`,
    agentId,
    tenantId,
    pluginId,
    pluginVersion: pluginVersionId,
    pluginVersionId,
    capability,
    actions: readStringArray(token.actions),
    paths: readStringArray(token.allowedPaths),
    services: readStringArray(token.allowedServices),
    artifactDigests: readStringArray(token.artifactDigests),
    planDigest,
    token,
    policyDecision,
    ...(plan ? { plan } : {}),
    ...(receipt ? { receipt } : {}),
  };
}

type AgentPlanAuthorizationInput = NonNullable<NonNullable<Parameters<UnifiedAgentPlanCompilerService['compile']>[0]['v2Request']>['authorization']>;

function readAgentPlanAuthorization(value: unknown): AgentPlanAuthorizationInput | undefined {
  const record = readRecord(value);
  return record ? record as AgentPlanAuthorizationInput : undefined;
}


export class WorkflowExecutorAdapter implements Executor {
  readonly type = 'WORKFLOW';
  private readonly workflows: WorkflowTemplatesApplicationService;
  private readonly curlExecutor: CurlExecutor;
  private readonly sshExecutor: SSHExecutor;
  private readonly stepExecutors: WorkflowStepExecutorRegistry;
  private readonly recovery: WorkflowRecoveryLedgerService;
  private readonly resourceLocks: PluginResourceLockService;
  private readonly executionGrants?: ExecutionGrantService;

  constructor(options: { workflows?: WorkflowTemplatesApplicationService; curlExecutor?: CurlExecutor; sshExecutor?: SSHExecutor; recovery?: WorkflowRecoveryLedgerService; resourceLocks?: PluginResourceLockService; executionGrants?: ExecutionGrantService } = {}) {
    this.workflows = options.workflows ?? new WorkflowTemplatesApplicationService();
    this.curlExecutor = options.curlExecutor ?? new CurlExecutor();
    this.sshExecutor = options.sshExecutor ?? new SSHExecutor();
    this.recovery = options.recovery ?? new WorkflowRecoveryLedgerService();
    this.resourceLocks = options.resourceLocks ?? new PluginResourceLockService();
    this.executionGrants = options.executionGrants;
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
      {
        executorId: 'workflow.checkpoint_verify',
        execute: async (context) => context.plan?.matched === true
          ? { success: true, body: { expectedHash: context.plan.expectedHash, actualHash: context.plan.actualHash }, logs: ['workflow:checkpoint_verify:matched'] }
          : { success: false, errorCode: 'WORKFLOW_CHECKPOINT_HASH_MISMATCH', errorMessage: '恢复快照哈希不一致，停止自动回滚', body: { expectedHash: context.plan?.expectedHash, actualHash: context.plan?.actualHash } },
      },
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
    const resolvedInput = readResolvedDeploymentInputV1(input.step.inputSnapshot.resolvedDeploymentInput);
    if (!resolvedInput) {
      return { success: false, errorCode: 'VALIDATION_FAILED', errorMessage: 'WORKFLOW 执行缺少统一部署输入快照' };
    }
    const runtimeInput = {
      templateVersionId: workflowVersionId,
      mode: input.dryRun ? 'render_only' as const : 'real_test' as const,
      ...(input.dryRun ? { dispatchInRenderOnly: true } : {}),
      resolvedInput,
      ...(readRecord(input.step.inputSnapshot.stepOutputs)
        ? { stepOutputs: structuredClone(readRecord(input.step.inputSnapshot.stepOutputs)) }
        : {}),
      ...(request.executionBranch === 'rollback' ? { executionBranch: 'rollback' as const } : {}),
    };
    let workflowIdentity: Record<string, unknown> = {
      pluginId: stringFromSnapshot(request.pluginId),
      pluginVersion: stringFromSnapshot(request.pluginVersion),
      pluginVersionId: stringFromSnapshot(request.pluginVersionId),
      workflowVersionId,
    };
    let resourceLock: PluginResourceLockRecord | undefined;
    try {
      const workflowVersion = await this.workflows.getVersion(workflowVersionId);
      workflowIdentity = {
        ...workflowIdentity,
        workflowTemplateId: workflowVersion.templateId,
        workflowVersion: workflowVersion.version,
        workflowName: workflowVersion.content.metadata.name,
        workflowDslVersion: workflowVersion.content.metadata.version,
      };
      resourceLock = input.dryRun ? undefined : await this.acquireWorkflowResourceLock(input, request, resolvedInput.assetContext);
      const recoveryLedger = input.dryRun ? undefined : await this.beginRecoveryLedger(input, request, runtimeInput);
      const reportWorkflowProgress = async (workflowProgress: WorkflowRunProgress) => {
        await input.reportProgress?.({
          mode: input.dryRun ? 'workflow_plan' : 'workflow_runner',
          stepType: input.step.stepType,
          workflowProgress,
          workflowExecutionSteps: projectWorkflowBusinessSteps(input.step.id, workflowProgress),
        });
      };
      const workflowRun = await this.workflows.runWithDispatcher(
        runtimeInput,
        async (dispatch) => this.dispatchWorkflowStep(input, dispatch.renderedPlan, dispatch.step.name, dispatch.attempt, recoveryLedger),
        reportWorkflowProgress,
      );
      if (recoveryLedger) {
        await this.recovery.finish(
          recoveryLedger.tenantId,
          recoveryLedger.id,
          workflowRun.status === 'success' ? 'COMPLETED' : workflowRun.status === 'rolled_back' ? 'ROLLED_BACK' : 'MANUAL_INTERVENTION',
        );
      }
      const dryRunChecks = input.dryRun ? buildWorkflowDryRunChecks(workflowRun) : undefined;
      const detail = {
        mode: input.dryRun ? 'workflow_plan' : 'workflow_runner',
        workflowRequest: maskWorkflowRequest(request),
        workflowIdentity,
        workflowRun,
        workflowExecutionSteps: projectWorkflowBusinessSteps(input.step.id, workflowRun),
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
        return {
          success: false,
          errorCode: error.errorCode,
          errorMessage: error.message,
          detail: { ...(readRecord(error.details) ?? {}), workflowIdentity },
        };
      }
      return {
        success: false,
        errorCode: 'WORKFLOW_RUN_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        detail: { workflowIdentity },
      };
    } finally {
      if (resourceLock) {
        await this.resourceLocks.release({
          tenantId: resourceLock.tenantId,
          lockId: resourceLock.id,
          ownerRunId: resourceLock.ownerRunId,
          ownerStepId: resourceLock.ownerStepId,
        });
      }
    }
  }

  private async acquireWorkflowResourceLock(input: StepExecutionInput, request: Record<string, unknown>, assetContext: DeploymentAssetContextV1): Promise<PluginResourceLockRecord | undefined> {
    const pluginVersionId = stringFromSnapshot(request.pluginVersionId);
    if (!pluginVersionId) return undefined;
    const tenantId = requireExecutionTenantId(input.step, 'workflow resource lock');
    const requested = readRecord(request.resourceLock) ?? {};
    const hostId = assetContext.host?.id;
    const managedTargetId = assetContext.target?.id;
    const standaloneKey = stringFromSnapshot(request.standaloneStableKey);
    const resourceKey = stringFromSnapshot(requested.key)
      ?? (hostId ? `tenant:${tenantId}:device:${hostId}` : undefined)
      ?? (managedTargetId ? `tenant:${tenantId}:managed-target:${managedTargetId}` : undefined)
      ?? (standaloneKey ? `tenant:${tenantId}:standalone:${standaloneKey}` : undefined);
    if (!resourceKey) throw new AppError('VALIDATION_FAILED', '插件工作流缺少稳定资源锁键，Standalone 写操作拒绝并发执行');
    return await this.resourceLocks.acquire({
      tenantId,
      resourceKey,
      mode: String(requested.mode ?? 'WRITE') === 'READ' ? 'READ' : 'WRITE',
      ownerRunId: input.step.executionRunId,
      ownerStepId: input.step.id,
      ttlSeconds: Number(requested.ttlSeconds ?? 300),
    });
  }

  private async beginRecoveryLedger(
    input: StepExecutionInput,
    request: Record<string, unknown>,
    runtimeInput: Record<string, unknown>,
  ): Promise<WorkflowRecoveryLedgerRecord | undefined> {
    const pluginVersionId = stringFromSnapshot(request.pluginVersionId);
    const capabilityKey = stringFromSnapshot(request.capabilityKey);
    if (!pluginVersionId && !capabilityKey) return undefined;
    if (!pluginVersionId || !capabilityKey) {
      throw new AppError('VALIDATION_FAILED', '插件工作流恢复账本必须同时固定 pluginVersionId 和 capabilityKey');
    }
    const tenantId = requireExecutionTenantId(input.step, 'workflow recovery ledger');
    return await this.recovery.begin({
      tenantId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      deploymentPlanTargetId: input.step.deploymentPlanTargetId,
      pluginVersionId,
      workflowVersionId: String(runtimeInput.templateVersionId),
      capabilityKey,
      target: readRecord(readRecord(runtimeInput.resolvedInput)?.assetContext) ?? {},
      plan: request,
      runtimeInput,
    });
  }

  private async dispatchWorkflowStep(input: StepExecutionInput, renderedPlan: unknown, workflowStepName: string, attempt: number, recoveryLedger?: WorkflowRecoveryLedgerRecord): Promise<WorkflowExecutorDispatchResult> {
    const plan = readRecord(renderedPlan);
    const executor = stringFromSnapshot(plan?.executor);
    if (executor === 'workflow.checkpoint') {
      const capture = readRecord(plan?.capture) ?? {};
      const captureHash = stringFromSnapshot(plan?.captureHash);
      const checkpointName = stringFromSnapshot(plan?.checkpointName);
      if (!checkpointName) return { success: false, errorCode: 'WORKFLOW_CHECKPOINT_INVALID', errorMessage: 'checkpoint 执行计划缺少名称' };
      // Dry-run 只验证 checkpoint 计划，不创建会参与正式恢复分类的持久化账本。
      if (input.dryRun) {
        if (plan?.deferred === true) {
          const deferredCapturePaths = readRecord(plan.deferredCapturePaths);
          if (!deferredCapturePaths || Object.keys(deferredCapturePaths).length === 0) {
            return { success: false, errorCode: 'WORKFLOW_CHECKPOINT_INVALID', errorMessage: '延迟 checkpoint 执行计划缺少捕获路径' };
          }
          return {
            success: true,
            body: { checkpointName, deferredCapturePaths, plannedOnly: true, persisted: false },
            logs: [`workflow:checkpoint:${checkpointName}:validated:deferred`],
          };
        }
        if (!captureHash) return { success: false, errorCode: 'WORKFLOW_CHECKPOINT_INVALID', errorMessage: 'checkpoint 执行计划缺少哈希' };
        return {
          success: true,
          body: { checkpointName, captureHash, plannedOnly: true, persisted: false },
          logs: [`workflow:checkpoint:${checkpointName}:validated`],
        };
      }
      if (!captureHash) return { success: false, errorCode: 'WORKFLOW_CHECKPOINT_INVALID', errorMessage: 'checkpoint 执行计划缺少哈希' };
      if (!recoveryLedger) return { success: false, errorCode: 'WORKFLOW_RECOVERY_LEDGER_REQUIRED', errorMessage: 'checkpoint 执行前必须创建恢复账本' };
      await this.recovery.recordCheckpoint({
        tenantId: recoveryLedger.tenantId,
        ledgerId: recoveryLedger.id,
        checkpointName,
        workflowStepName,
        capture,
        captureHash,
        requiredForRollback: plan?.requiredForRollback === true,
      });
      await this.recovery.markStepCompleted(recoveryLedger.tenantId, recoveryLedger.id, workflowStepName);
      return { success: true, body: { checkpointName, captureHash }, logs: [`workflow:checkpoint:${checkpointName}:saved`] };
    }
    const authorization = readExecutionAuthorization(input.step.inputSnapshot.executionAuthorization);
    const workflowVersionId = stringFromSnapshot(readRecord(input.step.inputSnapshot.workflowRequest)?.workflowVersionId)
      ?? stringFromSnapshot(input.step.inputSnapshot.workflowVersionId)
      ?? authorization?.workflowVersionId;
    const curlRequest = executor === '017.CURL_HTTP' ? readRecord(plan?.curlRequest) : undefined;
    const curlTemplate = readRecord(curlRequest?.template) ?? {};
    const curlTls = readRecord(curlTemplate.tls) ?? {};
    const allowInsecureTls = authorization?.allowInsecureTls === true;
    const isInsecureTlsRequest = executor === '017.CURL_HTTP' && curlTls.verify === false;
    const allowInsecureAction = executor === '017.CURL_HTTP'
      && isInsecureTlsRequest
      && allowInsecureTls
      && (input.dryRun || authorization?.approved === true)
      ? 'workflow.tls.insecure'
      : undefined;
    const childStepId = workflowChildStepId(input.step, executor ?? 'unknown', workflowStepName, attempt);
    const tenantId = requireExecutionTenantId(input.step, 'workflow child grant');
    // dry-run 也签发仅绑定当前 dry_run step 的短期 Grant，使预检能完整验证授权链；
    // 该 Grant 的 runId 不同于正式执行，且始终在当前工作流节点结束后撤销。
    const grant = this.executionGrants && executor
      ? await this.executionGrants.create({
          tenantId,
          planId: authorization?.planId ?? stringFromSnapshot(input.step.inputSnapshot.deploymentPlanId),
          runId: input.step.executionRunId,
          stepId: childStepId,
          targetId: authorization?.targetId ?? input.step.deploymentPlanTargetId,
          workflowVersionId,
          approvalId: authorization?.approvalId,
          executorType: executor,
          allowedSecretRefs: collectReferencesByScheme(plan, 'secret://'),
          allowedArtifactRefs: collectReferencesByScheme(plan, 'artifact://'),
          allowedActions: ['workflow.step.execute', executor, ...(allowInsecureAction ? [allowInsecureAction] : [])],
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        })
      : undefined;
    try {
      const grantedPlan = grant ? { ...plan, executionGrantId: grant.id } : plan;
      const result = enforceWorkflowResultLimits(await this.stepExecutors.execute(executor, { input, plan: grantedPlan, workflowStepName, attempt }));
      if (recoveryLedger && result.success) await this.recovery.markStepCompleted(recoveryLedger.tenantId, recoveryLedger.id, workflowStepName);
      return result;
    } finally {
      if (grant) await this.executionGrants?.revoke(grant.id);
    }
  }

  private async executeCurlWorkflowStep(context: WorkflowStepExecutorContext): Promise<WorkflowExecutorDispatchResult> {
    const executionGrantId = stringFromSnapshot(context.plan?.executionGrantId);
    const childStep = workflowChildStep(context.input.step, `workflow-curl-${context.workflowStepName}-${context.attempt}`, {
      curlRequest: toWorkflowCurlRequest(context.plan, context.input.step, context.workflowStepName, context.attempt),
      ...(executionGrantId ? { executionGrantId } : {}),
    });
    if (typeof this.curlExecutor.executeForWorkflow === 'function') {
      const request = childStep.inputSnapshot.curlRequest as CurlExecutionRequest | undefined;
      if (!request) return { success: false, errorCode: 'CURL_REQUEST_REQUIRED', errorMessage: '工作流节点缺少 curlRequest' };
      const authorization = readExecutionAuthorization(context.input.step.inputSnapshot.executionAuthorization);
      const curlContext = {
        runId: childStep.executionRunId,
        stepId: childStep.id,
        tenantId: childStep.tenantId,
        actorId: 'curl-executor',
        planId: authorization?.planId ?? stringFromSnapshot(context.input.step.inputSnapshot.deploymentPlanId),
        targetId: authorization?.targetId ?? context.input.step.deploymentPlanTargetId,
        workflowVersionId: stringFromSnapshot(readRecord(context.input.step.inputSnapshot.workflowRequest)?.workflowVersionId)
          ?? stringFromSnapshot(context.input.step.inputSnapshot.workflowVersionId)
          ?? authorization?.workflowVersionId,
        approvalId: authorization?.approvalId,
        executionGrantId,
        allowInsecureTls: authorization?.allowInsecureTls === true,
        executionGrantService: this.executionGrants,
      };
      if (context.input.dryRun) {
        await this.curlExecutor.validateForWorkflow(request, curlContext);
        return { success: true, body: { plannedOnly: true, curlValidation: 'passed' }, logs: ['curl:preflight:validated'] };
      }
      const execution = await this.curlExecutor.executeForWorkflow(request, false, curlContext);
      return curlWorkflowOutput(execution.result, execution.runtimeResponse);
    }
    const result = await this.curlExecutor.executeStep({ ...context.input, step: childStep, dryRun: context.input.dryRun });
    return curlWorkflowOutput(result);
  }

  private async executeSshWorkflowStep(context: WorkflowStepExecutorContext): Promise<WorkflowExecutorDispatchResult> {
    const result = await this.sshExecutor.executeStep({
      ...context.input,
      step: workflowChildStep(context.input.step, `workflow-ssh-${context.workflowStepName}-${context.attempt}`, {
        sshRequest: toWorkflowSshRequest(context.plan, context.input.step, context.workflowStepName, context.attempt),
      }),
      dryRun: context.input.dryRun,
    });
    return sshWorkflowOutput(result);
  }

}

function normalizeCertificateFingerprint(value?: string): string | undefined {
  const normalized = value?.replace(/:/g, '').trim().toLowerCase();
  return normalized || undefined;
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
  private readonly agentPlanCompiler?: UnifiedAgentPlanCompilerService;

  constructor(options: { gatewayTasks?: GatewayTaskService; agents?: AgentsApplicationService; grants?: ForwardingGrantService; auditWriter?: GatewayTaskAuditWriter; agentPlanCompiler?: UnifiedAgentPlanCompilerService } = {}) {
    this.gatewayTasks = options.gatewayTasks ?? new GatewayTaskService({ auditWriter: options.auditWriter });
    this.agents = options.agents ?? new AgentsApplicationService();
    this.grants = options.grants ?? new ForwardingGrantService();
    this.agentPlanCompiler = options.agentPlanCompiler;
  }

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const tenantId = requireExecutionTenantId(input.step, 'gateway route execute');
    const route = readRecord(input.step.inputSnapshot.gatewayRoute);
    const gatewayId = stringFromSnapshot(input.step.inputSnapshot.gatewayId) ?? stringFromSnapshot(route?.gatewayId) ?? `gw_${input.step.deploymentPlanTargetId ?? 'default'}`;
    const gatewayAgentId = stringFromSnapshot(route?.agentId);
    const delegatedTargetId = stringFromSnapshot(input.step.inputSnapshot.delegatedTargetId) ?? stringFromSnapshot(route?.delegatedTargetId) ?? input.step.deploymentPlanTargetId ?? input.step.id;
    const taskType = gatewayTaskTypeForStep(input.step);
    const routeChannel = gatewayRouteChannel(taskType, input.step.inputSnapshot, route);
    const delegatedAgentId = stringFromSnapshot(input.step.inputSnapshot.targetAgentId)
      ?? stringFromSnapshot(input.step.inputSnapshot.delegatedAgentId)
      ?? stringFromSnapshot(input.step.inputSnapshot.agentId)
      ?? delegatedTargetId;
    if (!this.gatewayTasks.hasDurablePersistence) {
      return {
        success: false,
        errorCode: 'EXECUTION_TARGET_UNAVAILABLE',
        errorMessage: 'Gateway v2 缺少持久化 GatewayTask 仓储，拒绝创建不可恢复的执行任务',
        detail: { mode: 'gateway_v2_dispatch_failed', reason: 'GATEWAY_V2_TASK_PERSISTENCE_UNAVAILABLE', fallback: false },
      };
    }
    if (!gatewayAgentId) {
      return {
        success: false,
        errorCode: 'GATEWAY_AGENT_ID_REQUIRED',
        errorMessage: 'Gateway 路由必须指定 gatewayRoute.agentId，拒绝在控制面本地伪执行',
        detail: { mode: 'gateway_route_dispatch_failed', gatewayId, taskType, fallback: false },
      };
    }
    const forwardingGrant = this.grants.issue({
      gatewayId,
      delegatedTargetId,
      delegatedAgentId,
      tenantId,
      taskType,
      routeChannel,
      executionRunId: input.step.executionRunId,
      stepId: input.step.id,
    });
    let v2Payload: Record<string, unknown>;
    try {
      const preparedSnapshot = await this.prepareGatewayV2Snapshot(input, delegatedAgentId);
      v2Payload = buildGatewayRoutePayload(input, taskType, delegatedTargetId, delegatedAgentId, forwardingGrant.id, forwardingGrant, preparedSnapshot);
    } catch (error) {
      const appError = error instanceof AppError ? error : undefined;
      return {
        success: false,
        errorCode: appError?.errorCode ?? 'VALIDATION_FAILED',
        errorMessage: appError?.message ?? (error instanceof Error ? error.message : String(error)),
      };
    }
    const task = this.gatewayTasks.dispatch({
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      tenantId,
      planId: stringFromSnapshot(input.step.inputSnapshot.deploymentPlanId),
      executionRunId: input.step.executionRunId,
      stepId: input.step.id,
      gatewayId,
      delegatedTargetId,
      target: {
        id: delegatedTargetId,
        zoneId: stringFromSnapshot(input.step.inputSnapshot.zoneId) ?? stringFromSnapshot(route?.zoneId) ?? 'default',
        ...(stringFromSnapshot(input.step.inputSnapshot.targetHost) ?? stringFromSnapshot(route?.host)
          ? { host: stringFromSnapshot(input.step.inputSnapshot.targetHost) ?? stringFromSnapshot(route?.host) } : {}),
        ...(numberFromSnapshot(input.step.inputSnapshot.targetPort) ?? numberFromSnapshot(route?.port)
          ? { port: numberFromSnapshot(input.step.inputSnapshot.targetPort) ?? numberFromSnapshot(route?.port) } : {}),
      },
      adapter: routeChannel,
      action: taskType,
      payload: v2Payload,
      grant: v2Payload.gatewayGrant as GatewayGrantV1,
      forwardingGrant,
    });
    await this.gatewayTasks.flushPersistence();

    const agentTask = await this.agents.enqueueTask(tenantId, {
      agentId: gatewayAgentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      idempotencyKey: task.idempotencyKey,
      payload: {
        // 直连 Agent v2 要求授权材料位于任务顶层；GatewayTask 仅作为路由审计与恢复引用保留。
        actionType: v2Payload.actionType,
        token: v2Payload.token,
        policyDecision: v2Payload.policyDecision,
        ...(v2Payload.plan ? { plan: v2Payload.plan } : {}),
        ...(v2Payload.receipt ? { receipt: v2Payload.receipt } : {}),
        gatewayTask: task,
      },
      }, `gateway-execution-step:${input.step.id}`);
    await this.gatewayTasks.flushPersistence();
    return {
      success: true,
      asyncPending: true,
      detail: {
        mode: 'gateway_v2_control_plane_queue',
        gatewayTaskId: task.id,
        agentTaskId: agentTask.id,
        gatewayId,
        gatewayAgentId,
        delegatedTargetId,
        delegatedAgentId,
        forwardingGrantId: forwardingGrant.id,
        taskType,
        routeChannel,
      },
    };
  }

  private async prepareGatewayV2Snapshot(input: StepExecutionInput, agentId: string): Promise<Record<string, unknown>> {
    const snapshot = input.step.inputSnapshot;
    const requestedActionType = requireGatewayActionType(snapshot.actionType);
    if (requestedActionType !== 'agent.plan.validate' && requestedActionType !== 'agent.plan.execute') return snapshot;
    if (!this.agentPlanCompiler) {
      throw new AppError('AGENT_PLUGIN_SERVICE_REQUIRED', 'Gateway Agent v2 缺少统一 Plan 编译器，拒绝进入执行队列');
    }
    const runtimeCapability = readRecord(snapshot.pluginRuntimeCapability);
    const executionSource = readRecord(snapshot.executionSource);
    const pluginBindingId = stringFromSnapshot(snapshot.pluginBindingId)
      ?? stringFromSnapshot(runtimeCapability?.pluginBindingId)
      ?? stringFromSnapshot(executionSource?.pluginBindingId);
    if (!pluginBindingId) throw new AppError('AGENT_PLUGIN_BINDING_REQUIRED', 'Gateway Agent v2 缺少统一 Binding ID');
    const pluginVersionId = stringFromSnapshot(runtimeCapability?.pluginVersionId)
      ?? stringFromSnapshot(executionSource?.pluginVersionId)
      ?? stringFromSnapshot(snapshot.pluginVersionId);
    if (!pluginVersionId) throw new AppError('VALIDATION_FAILED', 'Gateway Agent v2 缺少固定 PluginVersion');
    const resolvedInput = readResolvedDeploymentInputV1(snapshot.resolvedDeploymentInput);
    if (!resolvedInput) throw new AppError('VALIDATION_FAILED', 'Gateway Agent v2 缺少统一部署输入快照');
    const actionType = input.dryRun && requestedActionType === 'agent.plan.execute' ? 'agent.plan.validate' : requestedActionType;
    const envelope = await this.agentPlanCompiler.compile({
      tenantId: requireExecutionTenantId(input.step, 'gateway agent plan compile'),
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      pluginVersionId,
      pluginBindingId,
      resolvedInput,
      executionMode: input.runType === 'rollback' ? 'ROLLBACK' : input.dryRun ? 'PREFLIGHT' : 'APPLY',
      v2Request: {
        actionType,
        plan: snapshot.plan,
        authorization: readAgentPlanAuthorization(snapshot.executionAuthorization),
      },
    });
    return {
      ...snapshot,
      actionType: envelope.actionType,
      plan: envelope.plan,
      token: envelope.token,
      policyDecision: envelope.policyDecision,
    };
  }
}

export class ControlPlaneTlsExecutor implements Executor {
  readonly type = 'CONTROL_PLANE_TLS';

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const target = buildControlPlaneTlsTarget(input.step.inputSnapshot);
    const verification = readRecord(input.step.inputSnapshot.certificateVerification);
    const expectedFingerprint = normalizeCertificateFingerprint(stringFromSnapshot(verification?.expectedFingerprintSha256));
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
      const expectedDomains = readStringArray(verification?.expectedDomains);
      const evaluation = evaluateTlsVerification(report, expectedFingerprint, expectedDomains, input.dryRun);
      const actualFingerprint = normalizeCertificateFingerprint(report.remoteCertificateSha256);
      if (!evaluation.success) {
        return {
          success: false,
          errorCode: evaluation.errorCode,
          errorMessage: evaluation.errorMessage,
          detail: { mode: 'control_plane_tls_verify_failed', verify: report, expectedFingerprintSha256: expectedFingerprint, domainMismatches: evaluation.domainMismatches },
        };
      }
      return {
        success: true,
        detail: {
          mode: input.dryRun ? 'control_plane_tls_verify_preflight' : 'control_plane_tls_verify',
          executor: this.type,
          warning: evaluation.warning === true,
          changeRequired: evaluation.changeRequired === true,
          verify: report,
          certificateVerification: {
            capabilityKey: 'certificate.verify',
            schemaVersion: '1.0',
            source: 'CONTROL_PLANE',
            expectedFingerprintSha256: expectedFingerprint,
            remoteCertificateSha256: actualFingerprint,
            matched: evaluation.matched,
            domainMismatches: evaluation.domainMismatches,
          },
          newThumbprint: report.remoteThumbprint,
        },
      };
    } catch (error) {
      if (input.dryRun) {
        return {
          success: true,
          detail: {
            mode: 'control_plane_tls_verify_warning',
            executor: this.type,
            warning: true,
            message: `部署后将由平台后端验证 TLS 端点；当前端点暂不可达：${error instanceof Error ? error.message : String(error)}`,
            target,
          },
        };
      }
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
  const verification = readRecord(snapshot.certificateVerification);
  if (stringFromSnapshot(verification?.capabilityKey) !== 'certificate.verify' || stringFromSnapshot(verification?.schemaVersion) !== '1.0') return undefined;
  const verifyUrl = stringFromSnapshot(verification?.verifyUrl);
  if (verifyUrl) {
    const target = buildTlsVerifyTargetFromUrl(verifyUrl);
    const serverName = stringFromSnapshot(verification?.serverName);
    return serverName ? { ...target, serverName } : target;
  }
  const connectHost = stringFromSnapshot(verification?.connectHost);
  const serverName = stringFromSnapshot(verification?.serverName);
  const port = readNumberValue(verification?.port);
  if (!connectHost || !serverName || !port) return undefined;
  return { host: connectHost, port, serverName, target: `https://${serverName}:${port}` };
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

function workflowChildStepId(parent: ExecutionStepEntity, executor: string, workflowStepName: string, attempt: number): string {
  const prefix = executor === '017.CURL_HTTP' ? 'workflow-curl' : executor === '015.SSH' ? 'workflow-ssh' : `workflow-${executor.toLowerCase()}`;
  return `${parent.id}:${prefix}-${workflowStepName}-${attempt}`;
}

function readExecutionAuthorization(value: unknown): {
  tenantId?: string;
  planId?: string;
  targetId?: string;
  approvalId?: string;
  workflowVersionId?: string;
  snapshotHash?: string;
  approved?: boolean;
  allowInsecureTls?: boolean;
} | undefined {
  const authorization = readRecord(value);
  if (!authorization) return undefined;
  return {
    tenantId: stringFromSnapshot(authorization.tenantId),
    planId: stringFromSnapshot(authorization.planId),
    targetId: stringFromSnapshot(authorization.targetId),
    approvalId: stringFromSnapshot(authorization.approvalId),
    workflowVersionId: stringFromSnapshot(authorization.workflowVersionId),
    snapshotHash: stringFromSnapshot(authorization.snapshotHash),
    approved: authorization.approved === true,
    allowInsecureTls: authorization.allowInsecureTls === true,
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

function requireExecutionTenantId(step: ExecutionStepEntity, reason: string): string {
  const tenantId = step.tenantId ?? stringFromSnapshot(step.inputSnapshot.tenantId);
  if (!tenantId) {
    throw new AppError('TENANT_CONTEXT_INVALID', '执行步骤缺少租户上下文，拒绝继续执行', {
      stepId: step.id,
      executionRunId: step.executionRunId,
      reason,
    });
  }
  return tenantId;
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
  return enrichWorkflowCertificateMaterial({
    ...material,
    fingerprintSha256: material.fingerprintSha256 ?? material.expectedFingerprintSha256 ?? snapshot.expectedCertificateFingerprintSha256,
    files,
    outputs: existingOutputs && Object.keys(existingOutputs).length > 0
      ? existingOutputs
      : buildWorkflowCertificateOutputs(files),
  });
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
  const timeoutMs = typeof plan?.timeoutMs === 'number' ? plan.timeoutMs : undefined;
  const directRequest = stripLegacySshFields(readRecord(plan?.sshRequest));
  const program = stringFromSnapshot(plan?.program);
  const args = readStringArray(plan?.args);
  const argumentTemplate = stringFromSnapshot(plan?.argumentTemplate);
  return {
    ...(directRequest ?? {}),
    idempotencyKey: `${parent.executionRunId}:${parent.id}:workflow-ssh:${stepName}:${attempt}`,
    connection,
    ...(program ? { program } : {}),
    ...(args ? { args } : {}),
    ...(argumentTemplate ? { argumentTemplate } : {}),
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
  const detail = stripLegacySshFields(readRecord(result.detail));
  return {
    success: result.success,
    exitCode: typeof detail?.exitCode === 'number' ? detail.exitCode : result.success ? 0 : 1,
    stdout: typeof detail?.stdout === 'string' ? detail.stdout : '',
    body: detail,
    logs: readStringArray(detail?.logs),
    raw: detail,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

function stripLegacySshFields(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const { command: _command, commands: _commands, script: _script, commandResult: _commandResult, ...standard } = value;
  return standard;
}

function collectReferencesByScheme(value: unknown, scheme: 'secret://' | 'artifact://'): string[] {
  const references = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(new RegExp(`${scheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-zA-Z0-9/_#.:=-]+`, 'g'))) references.add(match[0]);
      return;
    }
    if (Array.isArray(item)) return item.forEach(visit);
    if (item && typeof item === 'object') Object.values(item as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return [...references].sort();
}

function enforceWorkflowResultLimits(result: WorkflowExecutorDispatchResult): WorkflowExecutorDispatchResult {
  const bodyBytes = Buffer.byteLength(JSON.stringify(result.body ?? null), 'utf8');
  const logBytes = Buffer.byteLength((result.logs ?? []).join('\n'), 'utf8');
  if (bodyBytes > 1024 * 1024) {
    return { success: false, errorCode: 'WORKFLOW_RESULT_TOO_LARGE', errorMessage: '工作流子步骤结果超过 1 MiB 上限', body: { bodyBytes } };
  }
  if (logBytes > 256 * 1024) {
    return { success: false, errorCode: 'WORKFLOW_LOG_TOO_LARGE', errorMessage: '工作流子步骤日志超过 256 KiB 上限', body: { logBytes } };
  }
  return result;
}

function gatewayTaskTypeForStep(step: ExecutionStepEntity): 'gateway.probe' | 'gateway.forward.agent_task' {
  const explicit = stringFromSnapshot(step.inputSnapshot.gatewayTaskType);
  if (explicit === 'gateway.probe' || explicit === 'gateway.forward.agent_task') return explicit;
  if (explicit) throw new AppError('VALIDATION_FAILED', 'Gateway 旧直连任务类型已退役，只允许 gateway.forward.agent_task', { gatewayTaskType: explicit });
  const forwardMode = stringFromSnapshot(step.inputSnapshot.gatewayForwardMode);
  if (forwardMode) throw new AppError('VALIDATION_FAILED', 'Gateway 旧直连转发模式已退役，只允许 Agent v2 队列转发', { gatewayForwardMode: forwardMode });
  if (step.stepType === 'DISCOVER' || step.stepType === 'VERIFY') return 'gateway.probe';
  return 'gateway.forward.agent_task';
}

function gatewayRouteChannel(taskType: string, snapshot: Record<string, unknown>, route: Record<string, unknown> | undefined): string {
  if (taskType === 'gateway.probe' && snapshot.stepType === 'VERIFY') return 'probe.tls';
  const explicit = stringFromSnapshot(snapshot.gatewayRouteChannel) ?? stringFromSnapshot(snapshot.gatewayAdapter) ?? stringFromSnapshot(route?.adapter);
  if (explicit) return normalizeGatewayRouteChannel(explicit, taskType);
  if (taskType === 'gateway.probe') return 'probe.tcp';
  return 'forward.agent_task';
}

function normalizeGatewayRouteChannel(value: string, taskType: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'probe.tls') return 'probe.tls';
  if (['http', 'https', 'curl', 'probe.http'].includes(normalized)) return 'probe.http';
  if (['tcp', 'probe.tcp'].includes(normalized)) return 'probe.tcp';
  if (['agent', 'probe.agent'].includes(normalized)) return 'probe.agent';
  if (['direct_control', 'forward.direct_control', 'gateway.forward.direct_control'].includes(normalized)) {
    throw new AppError('VALIDATION_FAILED', 'Gateway 旧 Direct Control 路由已退役，只允许 forward.agent_task', { gatewayRouteChannel: value });
  }
  if (['agent_task', 'forward.agent_task', 'gateway.forward.agent_task'].includes(normalized)) return 'forward.agent_task';
  if (taskType === 'gateway.probe') return 'probe.tcp';
  return 'forward.agent_task';
}

function buildGatewayRoutePayload(
  input: StepExecutionInput,
  taskType: string,
  delegatedTargetId: string,
  delegatedAgentId: string | undefined,
  forwardingGrantId: string,
  forwardingGrant: unknown,
  preparedSnapshot: Record<string, unknown> = input.step.inputSnapshot,
): Record<string, unknown> {
  const snapshot = preparedSnapshot;
  const token = requireRecord(snapshot.token, 'AgentCapabilityTokenV1');
  const policyDecision = requireRecord(snapshot.policyDecision, 'PolicyAuthorityDecisionV1');
  const actionType = requireGatewayActionType(snapshot.actionType);
  const pluginBinding = requireGatewayPluginBinding(snapshot, token, actionType);
  const plan = readRecord(snapshot.plan) ?? {};
  const receipt = readRecord(snapshot.receipt) ?? {};
  if ((actionType === 'agent.plan.validate' || actionType === 'agent.plan.execute') && Object.keys(plan).length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Gateway Agent v2 Plan 缺失，拒绝提交执行');
  }
  if (actionType === 'agent.execution.receipt' && Object.keys(receipt).length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Gateway Agent v2 Receipt 缺失，拒绝提交执行');
  }
  if (!delegatedAgentId) {
    throw new AppError('AUTH_FORBIDDEN', 'Gateway Agent v2 缺少 delegatedAgentId，拒绝提交执行');
  }
  if (token.tenantId !== input.step.tenantId || token.agentId !== delegatedAgentId || policyDecision.tenantId !== input.step.tenantId) {
    throw new AppError('AUTH_FORBIDDEN', 'Gateway Agent v2 授权材料与执行租户或目标 Agent 不一致');
  }
  const gatewayGrant = buildGatewayGrant(input, actionType, pluginBinding, token, policyDecision, forwardingGrantId, delegatedAgentId);
  const agentPayload = buildAgentV2ControlPayload(snapshot, input);
  return {
    type: taskType,
    ...agentPayload,
    gatewayGrant,
    forwardingGrant: forwardingGrant as Record<string, unknown>,
    pluginBinding,
    delegatedTargetId,
    delegatedAgentId,
    targetAgentId: delegatedAgentId,
    forwardingGrantId,
    dryRun: input.dryRun,
    runType: input.runType,
    stepType: input.step.stepType,
    executionRunId: input.step.executionRunId,
    executionStepId: input.step.id,
    targetPayload: agentPayload,
  };
}

function buildGatewayGrant(
  input: StepExecutionInput,
  actionType: string,
  pluginBinding: Record<string, string>,
  token: Record<string, unknown>,
  policyDecision: Record<string, unknown>,
  forwardingGrantId: string,
  delegatedAgentId: string,
): GatewayGrantV1 {
  const grant: GatewayGrantV1 = {
    grantId: stringFromSnapshot(input.step.inputSnapshot.gatewayGrantId) ?? newId('gwgrant'),
    tenantId: requireStringValue(input.step.tenantId, 'tenantId'),
    agentId: delegatedAgentId,
    actionType: actionType as GatewayGrantV1['actionType'],
    planId: stringFromSnapshot(input.step.inputSnapshot.deploymentPlanId) ?? requireStringValue(readRecord(input.step.inputSnapshot.plan)?.planId, 'planId'),
    planDigest: requireStringValue(token.planDigest, 'planDigest'),
    pluginId: pluginBinding.pluginId,
    pluginVersionId: pluginBinding.pluginVersionId,
    capability: requireStringValue(token.capability, 'capability'),
    tokenId: requireStringValue(token.tokenId, 'tokenId'),
    policyDecisionId: requireStringValue(policyDecision.decisionId, 'policyDecisionId'),
    nonce: requireStringValue(token.nonce, 'nonce'),
    revocationRef: requireStringValue(policyDecision.revocationRef, 'revocationRef'),
    forwardingGrantId,
  };
  return grant;
}

function requireGatewayPluginBinding(
  snapshot: Record<string, unknown>,
  token: Record<string, unknown>,
  actionType: string,
): Record<string, string> {
  const runtime = readRecord(snapshot.pluginRuntimeCapability) ?? {};
  const pluginId = requireStringValue(token.pluginId ?? snapshot.pluginId ?? runtime.pluginId, 'pluginId');
  const pluginVersionId = requireStringValue(token.pluginVersionId ?? snapshot.pluginVersionId ?? runtime.pluginVersionId, 'pluginVersionId');
  const pluginVersion = requireStringValue(snapshot.pluginVersion ?? runtime.pluginVersion, 'pluginVersion');
  const packageHash = requireSha256(snapshot.packageHash ?? snapshot.packageSha256 ?? runtime.packageHash ?? runtime.packageSha256, 'packageHash');
  const manifestHash = requireSha256(snapshot.manifestHash ?? snapshot.manifestSha256 ?? runtime.manifestHash ?? runtime.manifestSha256, 'manifestHash');
  const resourceHash = requireSha256(snapshot.resourceHash ?? runtime.resourceHash, 'resourceHash');
  const planDigest = requireStringValue(token.planDigest, 'planDigest');
  if (!/^[a-f0-9]{64}$/.test(planDigest)) throw new AppError('VALIDATION_FAILED', 'Gateway v2 planDigest 格式无效');
  if (token.capability !== undefined && typeof token.capability !== 'string') throw new AppError('VALIDATION_FAILED', 'Gateway Agent v2 capability 无效');
  return { pluginId, pluginVersionId, pluginVersion, packageHash, manifestHash, resourceHash, planDigest, capability: requireStringValue(token.capability ?? snapshot.capability, 'capability'), actionType };
}

function requireGatewayActionType(value: unknown): 'agent.fact.collect' | 'agent.plan.validate' | 'agent.plan.execute' | 'agent.execution.receipt' {
  const action = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const retiredAgentAction = ['agent.atomic_plan', 'execute'].join('.');
  const retiredCommandAction = ['command', 'execute'].join('.');
  if (action === retiredAgentAction || action === retiredCommandAction) throw new AppError('LEGACY_API_REMOVED', '旧 Agent 执行动作已退役，拒绝 Gateway 转发');
  if (action === 'agent.fact.collect' || action === 'agent.plan.validate' || action === 'agent.plan.execute' || action === 'agent.execution.receipt') return action;
  throw new AppError('VALIDATION_FAILED', 'Gateway Agent v2 缺少受支持的 actionType');
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  const result = readRecord(value) ?? {};
  if (Object.keys(result).length === 0) throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `${name} 缺失，Gateway 执行失败关闭`);
  return result;
}

function requireStringValue(value: unknown, name: string): string {
  const result = stringFromSnapshot(value);
  if (!result) throw new AppError('VALIDATION_FAILED', `Gateway v2 缺少 ${name}`);
  return result;
}

function requireSha256(value: unknown, name: string): string {
  const result = requireStringValue(value, name);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw new AppError('VALIDATION_FAILED', `Gateway v2 ${name} 必须是 sha256 摘要`);
  return result;
}

function numberFromSnapshot(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function gatewayActionIsWrite(value: unknown): boolean {
  return value === 'agent.plan.execute';
}

function readExecutionStatus(detail: Record<string, unknown> | undefined): 'SUCCESS' | 'FAILED' | 'UNKNOWN' | undefined {
  const value = detail?.executionStatus ?? detail?.status;
  return value === 'SUCCESS' || value === 'FAILED' || value === 'UNKNOWN' ? value : undefined;
}
