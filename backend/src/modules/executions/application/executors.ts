import { AppError } from '../../../common/errors/app-error.js';
import { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import { MockAdapterRuntime } from '../../gateway-agents/adapter-runtime.mock.js';
import { GatewayTaskService } from '../../gateway-agents/gateway-task.service.js';
import { LegacyTaskDispatcher } from '../../legacy-agents/legacy-task-dispatcher.js';
import { LegacyTaskTranslator } from '../../legacy-agents/legacy-task-translator.js';
import type { LegacyAgentProfile, UnifiedLegacyStep } from '../../legacy-agents/legacy-agent.types.js';
import { CurlExecutor, SSHExecutor, WindowsRemoteExecutor } from '../../executors/index.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';

export interface StepExecutionInput {
  step: ExecutionStepEntity;
  runType: string;
  dryRun: boolean;
}

export interface StepExecutionResult {
  success: boolean;
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
    this.executors.set(normalizeExecutorType(executor.type), executor);
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

function createDefaultExecutors(): Executor[] {
  return [
    new SSHExecutor(),
    new CurlExecutor(),
    new WindowsRemoteExecutorAdapter('WINRM'),
    new WindowsRemoteExecutorAdapter('SMB_WMI'),
    new AgentExecutorAdapter(),
    new GatewayExecutorAdapter(),
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

  constructor(private readonly agents = new AgentsApplicationService()) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const agentId = stringFromSnapshot(input.step.inputSnapshot.agentId) ?? stringFromSnapshot(input.step.inputSnapshot.executionTargetId) ?? stringFromSnapshot(input.step.inputSnapshot.deploymentPlanTargetId);
    if (!agentId) return { success: false, errorCode: 'AGENT_ID_REQUIRED', errorMessage: 'AGENT 执行器缺少 agentId/executionTargetId，拒绝伪装成功' };
    const task = this.agents.enqueueTask(input.step.tenantId ?? '', {
      agentId,
      executionRunId: input.step.executionRunId,
      executionStepId: input.step.id,
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      payload: { ...input.step.inputSnapshot, runType: input.runType, dryRun: input.dryRun },
    }, `execution-step:${input.step.id}`);
    return { success: true, detail: { mode: 'agent_task_enqueued', taskId: task.id, status: task.status } };
  }
}

export class GatewayExecutorAdapter implements Executor {
  readonly type = 'GATEWAY_SSH';

  constructor(private readonly gatewayTasks = new GatewayTaskService(), private readonly runtime = new MockAdapterRuntime()) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const route = readRecord(input.step.inputSnapshot.gatewayRoute);
    const gatewayId = stringFromSnapshot(input.step.inputSnapshot.gatewayId) ?? stringFromSnapshot(route?.gatewayId) ?? `gw_${input.step.deploymentPlanTargetId ?? 'default'}`;
    const delegatedTargetId = stringFromSnapshot(input.step.inputSnapshot.delegatedTargetId) ?? stringFromSnapshot(route?.delegatedTargetId) ?? input.step.deploymentPlanTargetId ?? input.step.id;
    const adapter = (stringFromSnapshot(input.step.inputSnapshot.gatewayAdapter) ?? stringFromSnapshot(route?.adapter) ?? 'ssh').toLowerCase();
    const task = this.gatewayTasks.dispatch({
      idempotencyKey: `${input.step.executionRunId}:${input.step.id}:${input.step.attemptCount}`,
      planId: stringFromSnapshot(input.step.inputSnapshot.deploymentPlanId),
      executionRunId: input.step.executionRunId,
      stepId: input.step.id,
      gatewayId,
      delegatedTargetId,
      target: { id: delegatedTargetId, zoneId: stringFromSnapshot(input.step.inputSnapshot.zoneId) ?? stringFromSnapshot(route?.zoneId) ?? 'default' },
      adapter,
      action: gatewayActionForStep(input.step),
      payload: { ...input.step.inputSnapshot, dryRun: input.dryRun },
    });
    const result = await this.runtime.run({ gatewayId }, task);
    return result.success
      ? { success: true, detail: { mode: 'gateway_adapter', taskId: task.id, status: result.status, summary: result.summary, evidence: result.evidence } }
      : { success: false, errorCode: 'GATEWAY_ADAPTER_FAILED', errorMessage: result.summary, detail: { mode: 'gateway_adapter', taskId: task.id, status: result.status, summary: result.summary, evidence: result.evidence } };
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

function gatewayActionForStep(step: ExecutionStepEntity): string {
  if (step.stepType === 'VERIFY' || step.stepType === 'DISCOVER') return 'read';
  if (step.stepType === 'INSTALL' || step.stepType === 'ROLLBACK') return 'write';
  return 'exec';
}

function stringFromSnapshot(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
