import { newId } from '../../shared/id.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import { MockAdapterRuntime } from './adapter-runtime.mock.js';
import type { AdapterExecutionResult, GatewayTask } from './gateway-agent.types.js';
import { GatewayTaskService } from './gateway-task.service.js';

export interface GatewayAgentProcessOptions {
  tenantId: string;
  agentId: string;
  agents: AgentsApplicationService;
  gatewayTasks: GatewayTaskService;
  runtime?: MockAdapterRuntime;
  leaseFactory?: () => string;
}

export interface GatewayAgentProcessTickResult {
  pulled: number;
  processed: number;
  succeeded: number;
  failed: number;
}

// GatewayAgentProcess 是真实 Gateway Agent 进程循环的最小可运行骨架：
// 它通过 Agent 控制面拉任务、ack、调用 Adapter Runtime、写 GatewayTask/Evidence、再回传 AgentTask 结果。
// 这里的默认 Runtime 仍是 mock-safe，协议真实联网由后续真实 Adapter 替换；任务通道本身不再是纸面契约。
export class GatewayAgentProcess {
  private readonly runtime: MockAdapterRuntime;
  private readonly leaseFactory: () => string;

  constructor(private readonly options: GatewayAgentProcessOptions) {
    this.runtime = options.runtime ?? new MockAdapterRuntime();
    this.leaseFactory = options.leaseFactory ?? (() => newId('gw_lease'));
  }

  async tick(limit = 10): Promise<GatewayAgentProcessTickResult> {
    const tasks = this.options.agents.pullTasks(this.options.tenantId, this.options.agentId, limit);
    const result: GatewayAgentProcessTickResult = { pulled: tasks.length, processed: 0, succeeded: 0, failed: 0 };
    const processedGatewayTaskIds = new Set<string>();
    for (const task of tasks) {
      if (!isGatewayTaskRun(task)) continue;
      result.processed += 1;
      processedGatewayTaskIds.add((task.payload.gatewayTask as GatewayTask).id);
      const processed = await this.process(task);
      if (processed.success) result.succeeded += 1;
      else result.failed += 1;
    }
    for (const gatewayTask of this.options.gatewayTasks.listRecoverable()) {
      if (processedGatewayTaskIds.has(gatewayTask.id)) continue;
      const agentTask = this.findRecoverableAgentTask(gatewayTask);
      if (!agentTask) continue;
      result.processed += 1;
      const processed = await this.process(agentTask, gatewayTask.leaseId);
      if (processed.success) result.succeeded += 1;
      else result.failed += 1;
    }
    return result;
  }

  private async process(agentTask: AgentTaskEnvelope, recoveredLeaseId?: string): Promise<{ success: boolean }> {
    const leaseId = recoveredLeaseId ?? agentTask.leaseId ?? this.leaseFactory();
    if (agentTask.status === 'queued' || agentTask.status === 'leased') {
      this.options.agents.ackTask(this.options.tenantId, { agentId: this.options.agentId, taskId: agentTask.id, leaseId });
    }
    const gatewayTask = (agentTask.payload.gatewayTask as GatewayTask);

    try {
      this.options.gatewayTasks.ack(gatewayTask.id, leaseId);
      this.options.gatewayTasks.markRunning(gatewayTask.id, leaseId);
      const current = this.options.gatewayTasks.get(gatewayTask.id)!;
      if (current.result) {
        this.submitAgentResult(agentTask, leaseId, current, current.result.success);
        return { success: current.result.success };
      }
      const adapterResult = await this.runtime.run({
        gatewayId: gatewayTask.gatewayId,
        credentialSessionId: gatewayTask.credentialSessionId,
        grantRef: gatewayTask.credentialLeaseId ? { ref: gatewayTask.credentialLeaseId } : undefined,
      }, gatewayTask);
      const completed = this.recordGatewayResult(agentTask, gatewayTask, leaseId, adapterResult);
      this.submitAgentResult(agentTask, leaseId, completed, completed.result?.success ?? adapterResult.success);
      return { success: completed.result?.success ?? adapterResult.success };
    } catch (error) {
      const failed = this.options.gatewayTasks.result(gatewayTask.id, leaseId, {
        success: false,
        status: 'failed',
        summary: error instanceof Error ? error.message : String(error),
        errorCode: 'GATEWAY_AGENT_PROCESS_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      this.options.agents.submitResult(this.options.tenantId, {
        agentId: this.options.agentId,
        taskId: agentTask.id,
        leaseId,
        success: false,
        errorCode: failed.result?.errorCode,
        errorMessage: failed.result?.errorMessage,
        detail: { mode: 'gateway_agent_process', gatewayTaskId: failed.id, gatewayTaskStatus: failed.status },
      });
      return { success: false };
    }
  }

  private recordGatewayResult(agentTask: AgentTaskEnvelope, gatewayTask: GatewayTask, leaseId: string, adapterResult: AdapterExecutionResult): GatewayTask {
    const evidenceIds = adapterResult.evidence.map((evidence) => this.options.gatewayTasks.appendEvidence({
      ...evidence,
      taskId: gatewayTask.id,
      gatewayId: gatewayTask.gatewayId,
      delegatedTargetId: gatewayTask.delegatedTargetId,
      adapter: gatewayTask.adapter,
      credentialSessionId: gatewayTask.credentialSessionId,
      credentialLeaseId: gatewayTask.credentialLeaseId,
    }).id);
    this.submitEvidenceLogs(agentTask, gatewayTask.id);
    return this.options.gatewayTasks.result(gatewayTask.id, leaseId, {
      success: adapterResult.success,
      status: adapterResult.status,
      summary: adapterResult.summary,
      evidenceIds,
      errorCode: adapterResult.success ? undefined : 'GATEWAY_ADAPTER_FAILED',
      errorMessage: adapterResult.success ? undefined : adapterResult.summary,
    });
  }

  private submitEvidenceLogs(agentTask: AgentTaskEnvelope, gatewayTaskId: string): void {
    const evidences = this.options.gatewayTasks.listEvidence(gatewayTaskId)
      .filter((evidence) => evidence.kind === 'log' || evidence.kind === 'command_summary' || evidence.kind === 'response_summary')
      .filter((evidence) => (evidence.sequence ?? 0) > 0);
    if (!evidences.length) return;
    const ack = this.options.agents.submitLogs(this.options.tenantId, {
      agentId: this.options.agentId,
      taskId: agentTask.id,
      logs: evidences.map((evidence) => ({
        sequence: evidence.sequence!,
        level: evidence.result === 'failed' ? 'error' : 'info',
        message: evidence.summary,
        emittedAt: evidence.createdAt,
      })),
    }, `gateway-evidence-${gatewayTaskId}`);
    this.options.gatewayTasks.updateEvidenceAckCursor(gatewayTaskId, ack.lastAckedSequence);
  }

  private submitAgentResult(agentTask: AgentTaskEnvelope, leaseId: string, completed: GatewayTask, success: boolean): void {
    this.options.agents.submitResult(this.options.tenantId, {
      agentId: this.options.agentId,
      taskId: agentTask.id,
      leaseId,
      success,
      errorCode: completed.result?.errorCode,
      errorMessage: completed.result?.errorMessage,
      detail: {
        mode: 'gateway_agent_process',
        gatewayTaskId: completed.id,
        gatewayTaskStatus: completed.status,
        delegatedTargetId: completed.delegatedTargetId,
        evidenceIds: completed.result?.evidenceIds ?? [],
        evidenceRef: completed.result?.evidenceRef,
        summary: completed.result?.summary,
      },
    });
  }

  private findRecoverableAgentTask(gatewayTask: GatewayTask): AgentTaskEnvelope | undefined {
    return this.options.agents.listTaskQueue(this.options.tenantId, this.options.agentId).tasks
      .find((task) => isGatewayTaskRun(task)
        && (task.payload.gatewayTask as GatewayTask).id === gatewayTask.id
        && ['queued', 'leased', 'acked'].includes(task.status));
  }
}

function isGatewayTaskRun(task: AgentTaskEnvelope): boolean {
  return task.payload.type === 'gateway.task.run' && Boolean(task.payload.gatewayTask);
}
