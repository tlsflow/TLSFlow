import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import { ForwardingGrantService } from '../../gateway-agents/forwarding-grant.service.js';
import type { GatewayTaskAuditWriter } from '../../gateway-agents/gateway-target-history.service.js';
import { GatewayTaskService } from '../../gateway-agents/gateway-task.service.js';
import { CurlExecutor, SSHExecutor, WindowsRemoteExecutor, type CurlExecutionRequest, type CurlExecutionResult, type HttpResponse } from '../../executors/index.js';
import { SecretServiceCurlResolver } from '../../executors/curl/curl.secret-resolver.js';
import { SecretServiceSshResolver } from '../../executors/ssh/ssh.secret-resolver.js';
import { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowConnectionBinding, WorkflowExecutorDispatchResult, WorkflowRunProgress, WorkflowRunResult } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';
import { AgentActionDispatchRegistry, type AgentActionDispatchResolution } from './agent-action-dispatch-registry.js';
import type { UnifiedAgentPlanCompilerService } from '../../plugins/application/unified-agent-plan-compiler.service.js';
import { canonicalAgentPlanJson } from '../../plugins/application/unified-agent-plan-compiler.service.js';
import { readHistoricalResolvedDeploymentInput, type HistoricalAgentActionResolver } from '../../plugins/application/historical-agent-action-resolver.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import { evaluateTlsVerification, probeTlsCertificate, type TlsVerifyTarget } from './tls-verification.js';
import { WorkflowRecoveryLedgerService, type WorkflowRecoveryLedgerRecord } from './workflow-recovery-ledger.service.js';
import { PluginResourceLockService, type PluginResourceLockRecord } from './plugin-resource-lock.service.js';
import { projectWorkflowBusinessSteps } from './workflow-business-step-projector.js';
import type { ExecutionGrantService } from '../execution-grant.service.js';
import { enrichWorkflowCertificateMaterial } from '../../certificates/artifacts/workflow-certificate-material.js';
import { normalizeAgentAtomicDryRunDetail } from './agent-atomic-dry-run.js';

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
  historicalAgentActions?: HistoricalAgentActionResolver;
  workflowRecovery?: WorkflowRecoveryLedgerService;
  pluginResourceLocks?: PluginResourceLockService;
  executionGrants?: ExecutionGrantService;
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
  const curlExecutor = new CurlExecutor(dependencies.secrets ? { secretResolver: new SecretServiceCurlResolver(dependencies.secrets) } : {});
  return [
	    sshExecutor,
	    curlExecutor,
	    new WorkflowExecutorAdapter({ workflows: dependencies.workflows, curlExecutor, sshExecutor, recovery: dependencies.workflowRecovery, resourceLocks: dependencies.pluginResourceLocks, executionGrants: dependencies.executionGrants }),
	    new WindowsRemoteExecutorAdapter('WINRM'),
    new WindowsRemoteExecutorAdapter('SMB_WMI'),
    new AgentExecutorAdapter(dependencies.agents, new AgentActionDispatchRegistry(), dependencies.agentPlanCompiler, dependencies.historicalAgentActions),
    new GatewayRouteExecutorAdapter({ agents: dependencies.agents, gatewayTasks: dependencies.gatewayTasks, auditWriter: dependencies.gatewayTaskAuditWriter }),
    new ControlPlaneTlsExecutor(),
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
    private readonly agentPlanCompiler?: UnifiedAgentPlanCompilerService,
    private readonly historicalAgentActions?: HistoricalAgentActionResolver,
  ) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const agentId = stringFromSnapshot(input.step.inputSnapshot.agentId) ?? stringFromSnapshot(input.step.inputSnapshot.executionTargetId) ?? stringFromSnapshot(input.step.inputSnapshot.deploymentPlanTargetId);
    if (!agentId) return { success: false, errorCode: 'AGENT_ID_REQUIRED', errorMessage: 'AGENT 执行器缺少 agentId/executionTargetId，拒绝伪装成功' };
    const requiredAction = this.actionDispatch.requireResolution(input.step.inputSnapshot);
    if (!requiredAction.ok) {
      if (requiredAction.errorCode === 'AGENT_ACTION_UNREGISTERED' && requiredAction.requestedActionType && this.historicalAgentActions) {
        const migrated = await this.resolveHistoricalAgentPayload(input, agentId, requiredAction.requestedActionType);
        if (migrated.error) return migrated.error;
        return this.executeResolvedPayload(input, agentId, migrated.payload, {
          requestedActionType: requiredAction.requestedActionType,
          actionType: 'agent.atomic_plan.execute',
          mode: 'direct_required',
          kind: 'HISTORICAL_PLUGIN_ALIAS',
          contract: { schemaVersions: ['legacy'], riskBoundary: 'DEPLOYMENT', acceptsSecrets: false },
          aliased: true,
        });
      }
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
    const task = await this.agents.enqueueDirectTask(input.step.tenantId ?? '', {
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      payload,
    }, `execution-step:${input.step.id}`);
    try {
      const reportDirectProgress = input.dryRun && payload.actionType === 'agent.atomic_plan.execute'
        ? async (detail: Record<string, unknown>) => input.reportProgress?.(normalizeAgentAtomicDryRunDetail(detail))
        : input.reportProgress;
      const direct = await this.agents.executeTaskDirect(
        input.step.tenantId ?? '',
        task.id,
        `execution-direct:${input.step.id}`,
        reportDirectProgress,
      );
      const detail = input.dryRun && payload.actionType === 'agent.atomic_plan.execute'
        ? normalizeAgentAtomicDryRunDetail(direct.detail ?? {})
        : direct.detail;
      const normalizedDryRunSuccess = input.dryRun
        && payload.actionType === 'agent.atomic_plan.execute'
        && isSuccessfulAtomicDryRun(detail);
      return {
        success: direct.success || normalizedDryRunSuccess,
        errorCode: normalizedDryRunSuccess ? undefined : direct.errorCode,
        errorMessage: normalizedDryRunSuccess ? undefined : direct.errorMessage,
        detail,
      };
    } catch (error) {
      const appError = error instanceof AppError ? error : undefined;
      return {
        success: false,
        errorCode: appError?.errorCode ?? 'DIRECT_EXECUTION_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        detail: {
          mode: 'agent_direct_execute_failed',
          dispatchMode: dispatch.mode,
          taskId: task.id,
        },
      };
    }
  }

  private async resolveHistoricalAgentPayload(input: StepExecutionInput, agentId: string, actionType: string): Promise<{
    payload: Record<string, unknown>;
    error?: undefined;
  } | { payload?: undefined; error: StepExecutionResult }> {
    if (!this.agentPlanCompiler || !this.historicalAgentActions) {
      return { error: this.historicalMigrationError(actionType) };
    }
    const resolvedInput = readHistoricalResolvedDeploymentInput(input.step.inputSnapshot.resolvedDeploymentInput);
    if (!resolvedInput) return { error: this.historicalMigrationError(actionType) };
    try {
      const migration = await this.historicalAgentActions.resolve({
        tenantId: input.step.tenantId ?? '',
        actionType,
        resolvedInput,
        frameworkType: stringFromSnapshot(input.step.inputSnapshot.frameworkType),
        productFamily: stringFromSnapshot(input.step.inputSnapshot.productFamily),
      });
      const plan = await (this.agentPlanCompiler.compile as unknown as (compilerInput: unknown) => Promise<Record<string, unknown>>)({
        tenantId: input.step.tenantId ?? '',
        agentId,
        executionRunId: input.step.executionRunId,
        executionStepId: input.step.id,
        pluginVersionId: migration.capability.pluginVersionId,
        pluginBindingId: migration.capability.binding.id,
        resolvedInput,
        executionMode: input.runType === 'rollback' ? 'ROLLBACK' : input.dryRun ? 'PREFLIGHT' : 'APPLY',
      });
      const planSha256 = `sha256:${createHash('sha256').update(canonicalAgentPlanJson(plan)).digest('hex')}`;
      return { payload: {
        actionType: 'agent.atomic_plan.execute',
        actionSchemaVersion: '1.0',
        plan,
        historicalActionMigration: {
          originalActionType: migration.originalActionType,
          capabilityKey: migration.alias.capabilityKey,
          pluginVersionId: migration.capability.pluginVersionId,
          pluginBindingId: migration.capability.binding.id,
          planSha256,
        },
      } };
    } catch (error) {
      const appError = error instanceof AppError ? error : undefined;
      const errorCode = appError?.errorCode === 'HISTORICAL_AGENT_ACTION_AMBIGUOUS'
        ? appError.errorCode
        : 'HISTORICAL_AGENT_ACTION_MIGRATION_REQUIRED';
      return { error: { success: false, errorCode, errorMessage: errorCode === 'HISTORICAL_AGENT_ACTION_AMBIGUOUS'
        ? '历史 Agent Action 在当前标准插件上下文中存在歧义'
        : '历史 Agent Action 无法转换，请重新生成部署计划', detail: { requestedActionType: actionType } } };
    }
  }

  private historicalMigrationError(actionType: string): StepExecutionResult {
    return { success: false, errorCode: 'HISTORICAL_AGENT_ACTION_MIGRATION_REQUIRED', errorMessage: '历史 Agent Action 无法转换，请重新生成部署计划', detail: { requestedActionType: actionType } };
  }

  private async resolveAgentPayload(input: StepExecutionInput, agentId: string, dispatch: AgentActionDispatchResolution): Promise<{
    payload: Record<string, unknown>;
    error?: undefined;
  } | {
    payload?: undefined;
    error: StepExecutionResult;
  }> {
    const snapshot = input.step.inputSnapshot;
    if (dispatch.kind !== 'ATOMIC_PLAN') {
      return { payload: buildRegisteredAgentPayload(snapshot, input) };
    }
    if (!this.agentPlanCompiler) {
      return { error: { success: false, errorCode: 'AGENT_PLUGIN_SERVICE_REQUIRED', errorMessage: '统一 Agent Plan 编译器未配置' } };
    }
    const pluginBindingId = stringFromSnapshot(snapshot.pluginBindingId);
    if (!pluginBindingId) return { error: { success: false, errorCode: 'AGENT_PLUGIN_BINDING_REQUIRED', errorMessage: 'Agent 插件执行缺少统一 Binding ID' } };
    const pluginVersionId = stringFromSnapshot(readRecord(snapshot.pluginRuntimeCapability)?.pluginVersionId);
    if (!pluginVersionId) return { error: { success: false, errorCode: 'VALIDATION_FAILED', errorMessage: 'Agent 插件执行缺少固定 PluginVersion' } };
    const resolvedInput = readResolvedDeploymentInput(snapshot.resolvedDeploymentInput);
    if (!resolvedInput) return { error: { success: false, errorCode: 'VALIDATION_FAILED', errorMessage: 'Agent 执行缺少统一部署输入快照' } };
    const plan = await this.agentPlanCompiler.compile({
      tenantId: input.step.tenantId ?? '',
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      pluginVersionId,
      pluginBindingId,
      resolvedInput,
      executionMode: input.runType === 'rollback' ? 'ROLLBACK' : input.dryRun ? 'PREFLIGHT' : 'APPLY',
    });
    return { payload: {
        actionType: 'agent.atomic_plan.execute',
        actionSchemaVersion: '1.0',
        plan,
      } };
  }
}

function buildRegisteredAgentPayload(snapshot: Record<string, unknown>, input: StepExecutionInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) payload[key] = value;
  payload.stepType = input.step.stepType;
  payload.runType = input.runType;
  payload.dryRun = input.dryRun;
  return payload;
}

function readResolvedDeploymentInput(value: unknown): ResolvedDeploymentInputV1 | undefined {
  const input = readRecord(value);
  if (input?.apiVersion !== 'gcac.resolved-deployment-input/v1') return undefined;
  if (!readRecord(input.assetContext) || !readRecord(input.variables) || !readRecord(input.connections)
    || !readRecord(input.credentials) || !readRecord(input.artifacts) || !readRecord(input.provenance)
    || !Array.isArray(input.sensitivePaths) || !Array.isArray(input.issues)
    || typeof input.executable !== 'boolean' || typeof input.resolvedSha256 !== 'string') return undefined;
  return input as unknown as ResolvedDeploymentInputV1;
}

function isSuccessfulAtomicDryRun(detail: Record<string, unknown> | undefined): boolean {
  const summary = readRecord(detail?.dryRunSummary);
  if (!summary) return false;
  return Number(summary.failed ?? 0) === 0 && Number(summary.unknown ?? 0) === 0;
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
    const runtimeInput = {
      templateVersionId: workflowVersionId,
      mode: input.dryRun ? 'render_only' as const : 'real_test' as const,
      userVariables: {
        ...(readRecord(request.variableBindings) ?? {}),
        ...(readRecord(request.parameterBindings) ?? {}),
        ...(readRecord(request.credentials) ?? {}),
      },
      assetVariables: buildWorkflowAssetVariables(input.step.inputSnapshot, request),
      connectionBindings: (readRecord(request.connectionBindings) ?? {}) as Record<string, WorkflowConnectionBinding>,
      certificateMaterials: buildWorkflowCertificateMaterials(input.step.inputSnapshot),
    };
    let resourceLock: PluginResourceLockRecord | undefined;
    try {
      resourceLock = input.dryRun ? undefined : await this.acquireWorkflowResourceLock(input, request, runtimeInput.assetVariables);
      const recoveryLedger = input.dryRun ? undefined : await this.beginRecoveryLedger(input, request, runtimeInput);
      const reportWorkflowProgress = async (workflowProgress: WorkflowRunProgress) => {
        await input.reportProgress?.({
          mode: input.dryRun ? 'workflow_plan' : 'workflow_runner',
          stepType: input.step.stepType,
          workflowProgress,
          workflowExecutionSteps: projectWorkflowBusinessSteps(input.step.id, workflowProgress),
        });
      };
      const workflowRun = input.dryRun
        ? await this.workflows.preview(runtimeInput, reportWorkflowProgress)
        : await this.workflows.runWithDispatcher(
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
        return { success: false, errorCode: error.errorCode, errorMessage: error.message, detail: error.details as Record<string, unknown> | undefined };
      }
      return { success: false, errorCode: 'WORKFLOW_RUN_FAILED', errorMessage: error instanceof Error ? error.message : String(error) };
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

  private async acquireWorkflowResourceLock(input: StepExecutionInput, request: Record<string, unknown>, assetVariables: Record<string, unknown>): Promise<PluginResourceLockRecord | undefined> {
    const pluginVersionId = stringFromSnapshot(request.pluginVersionId);
    if (!pluginVersionId) return undefined;
    const tenantId = input.step.tenantId ?? stringFromSnapshot(input.step.inputSnapshot.tenantId) ?? 'default';
    const requested = readRecord(request.resourceLock) ?? {};
    const managedContext = readRecord(request.managedContext) ?? readRecord(assetVariables.managedContext) ?? {};
    const hostId = stringFromSnapshot(managedContext.hostId) ?? stringFromSnapshot(assetVariables.hostId);
    const managedTargetId = stringFromSnapshot(managedContext.managedTargetId) ?? stringFromSnapshot(assetVariables.managedTargetId);
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
    const tenantId = input.step.tenantId ?? stringFromSnapshot(input.step.inputSnapshot.tenantId) ?? 'default';
    return await this.recovery.begin({
      tenantId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      deploymentPlanTargetId: input.step.deploymentPlanTargetId,
      pluginVersionId,
      workflowVersionId: String(runtimeInput.templateVersionId),
      capabilityKey,
      target: readRecord(runtimeInput.assetVariables) ?? {},
      plan: request,
      runtimeInput,
    });
  }

  private async dispatchWorkflowStep(input: StepExecutionInput, renderedPlan: unknown, workflowStepName: string, attempt: number, recoveryLedger?: WorkflowRecoveryLedgerRecord): Promise<WorkflowExecutorDispatchResult> {
    const plan = readRecord(renderedPlan);
    const executor = stringFromSnapshot(plan?.executor);
    if (executor === 'workflow.checkpoint') {
      if (!recoveryLedger) return { success: false, errorCode: 'WORKFLOW_RECOVERY_LEDGER_REQUIRED', errorMessage: 'checkpoint 执行前必须创建恢复账本' };
      const capture = readRecord(plan?.capture) ?? {};
      const captureHash = stringFromSnapshot(plan?.captureHash);
      const checkpointName = stringFromSnapshot(plan?.checkpointName);
      if (!captureHash || !checkpointName) return { success: false, errorCode: 'WORKFLOW_CHECKPOINT_INVALID', errorMessage: 'checkpoint 执行计划缺少名称或哈希' };
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
    const grant = this.executionGrants && executor
      ? await this.executionGrants.create({
          runId: input.step.executionRunId,
          stepId: `${input.step.id}:${workflowStepName}:${attempt}`,
          executorType: executor,
          allowedSecretRefs: collectReferencesByScheme(plan, 'secret://'),
          allowedArtifactRefs: collectReferencesByScheme(plan, 'artifact://'),
          allowedActions: ['workflow.step.execute', executor],
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

  constructor(options: { gatewayTasks?: GatewayTaskService; agents?: AgentsApplicationService; grants?: ForwardingGrantService; auditWriter?: GatewayTaskAuditWriter } = {}) {
    this.gatewayTasks = options.gatewayTasks ?? new GatewayTaskService({ auditWriter: options.auditWriter });
    this.agents = options.agents ?? new AgentsApplicationService();
    this.grants = options.grants ?? new ForwardingGrantService();
  }

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
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
        errorMessage: 'Gateway 路由必须指定 gatewayRoute.agentId，拒绝在控制面本地伪执行',
        detail: { mode: 'gateway_route_dispatch_failed', gatewayId, taskId: task.id, taskType },
      };
    }

    const agentTask = await this.agents.enqueueDirectTask(input.step.tenantId ?? '', {
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

    try {
      const direct = await this.agents.executeTaskDirect(
        input.step.tenantId ?? '',
        agentTask.id,
        `gateway-execution-direct:${input.step.id}`,
        input.reportProgress,
      );
      return {
        success: direct.success,
        errorCode: direct.errorCode,
        errorMessage: direct.errorMessage,
        detail: {
          mode: 'gateway_route_direct_execute',
          gatewayTaskId: task.id,
          agentTaskId: agentTask.id,
          gatewayId,
          gatewayAgentId,
          delegatedTargetId,
          delegatedAgentId,
          forwardingGrantId: forwardingGrant.id,
          taskType,
          routeChannel,
          ...(direct.detail ?? {}),
        },
      };
    } catch (error) {
      const appError = error instanceof AppError ? error : undefined;
      return {
        success: false,
        errorCode: appError?.errorCode ?? 'GATEWAY_DIRECT_EXECUTION_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        detail: {
          mode: 'gateway_route_direct_execute_failed',
          gatewayTaskId: task.id,
          agentTaskId: agentTask.id,
          gatewayId,
          gatewayAgentId,
          taskType,
          routeChannel,
        },
      };
    }
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

function gatewayTaskTypeForStep(step: ExecutionStepEntity): 'gateway.probe' | 'gateway.forward.agent_task' | 'gateway.forward.direct_control' {
  const explicit = stringFromSnapshot(step.inputSnapshot.gatewayTaskType);
  if (explicit === 'gateway.probe' || explicit === 'gateway.forward.agent_task' || explicit === 'gateway.forward.direct_control') return explicit;
  const forwardMode = stringFromSnapshot(step.inputSnapshot.gatewayForwardMode);
  if (forwardMode === 'direct_control') return 'gateway.forward.direct_control';
  if (step.stepType === 'DISCOVER' || step.stepType === 'VERIFY') return 'gateway.probe';
  return 'gateway.forward.agent_task';
}

function gatewayRouteChannel(taskType: string, snapshot: Record<string, unknown>, route: Record<string, unknown> | undefined): string {
  if (taskType === 'gateway.probe' && snapshot.stepType === 'VERIFY') return 'probe.tls';
  const explicit = stringFromSnapshot(snapshot.gatewayRouteChannel) ?? stringFromSnapshot(snapshot.gatewayAdapter) ?? stringFromSnapshot(route?.adapter);
  if (explicit) return normalizeGatewayRouteChannel(explicit, taskType);
  if (taskType === 'gateway.probe') return 'probe.tcp';
  if (taskType === 'gateway.forward.direct_control') return 'forward.direct_control';
  return 'forward.agent_task';
}

function normalizeGatewayRouteChannel(value: string, taskType: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'probe.tls') return 'probe.tls';
  if (['http', 'https', 'curl', 'probe.http'].includes(normalized)) return 'probe.http';
  if (['tcp', 'probe.tcp'].includes(normalized)) return 'probe.tcp';
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
