import { newId } from '../../shared/id.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import { ForwardingGrantService } from './forwarding-grant.service.js';
import type { GatewayTask } from './gateway-agent.types.js';
import { GatewayTaskService } from './gateway-task.service.js';

export interface GatewayAgentProcessOptions {
  tenantId: string;
  agentId: string;
  agents: AgentsApplicationService;
  gatewayTasks: GatewayTaskService;
  grants?: ForwardingGrantService;
  leaseFactory?: () => string;
}

export interface GatewayAgentProcessTickResult {
  pulled: number;
  processed: number;
  succeeded: number;
  failed: number;
}

export class GatewayAgentProcess {
  private readonly leaseFactory: () => string;
  private readonly grants: ForwardingGrantService;

  constructor(private readonly options: GatewayAgentProcessOptions) {
    this.leaseFactory = options.leaseFactory ?? (() => newId('gw_lease'));
    this.grants = options.grants ?? new ForwardingGrantService();
  }

  async tick(limit = 10): Promise<GatewayAgentProcessTickResult> {
    const tasks = await this.options.agents.pullTasks(this.options.tenantId, this.options.agentId, limit);
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
      const agentTask = await this.findRecoverableAgentTask(gatewayTask);
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
      await this.options.agents.ackTask(this.options.tenantId, { agentId: this.options.agentId, taskId: agentTask.id, leaseId });
    }
    const gatewayTask = agentTask.payload.gatewayTask as GatewayTask;

    try {
      this.options.gatewayTasks.ack(gatewayTask.id, leaseId);
      this.options.gatewayTasks.markRunning(gatewayTask.id, leaseId);
      const current = this.options.gatewayTasks.get(gatewayTask.id)!;
      if (current.result) {
        await this.submitAgentResult(agentTask, leaseId, current, current.result.success);
        return { success: current.result.success };
      }
      const completed = this.recordGatewayResult(agentTask, gatewayTask, leaseId, this.evaluateGatewayRouteTask(gatewayTask));
      await this.submitAgentResult(agentTask, leaseId, completed, completed.result?.success ?? false);
      return { success: completed.result?.success ?? false };
    } catch (error) {
      const failed = this.options.gatewayTasks.result(gatewayTask.id, leaseId, {
        success: false,
        status: 'failed',
        summary: error instanceof Error ? error.message : String(error),
        errorCode: 'GATEWAY_AGENT_PROCESS_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.options.agents.submitResult(this.options.tenantId, {
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

  private recordGatewayResult(agentTask: AgentTaskEnvelope, gatewayTask: GatewayTask, leaseId: string, routeResult: GatewayRouteProcessResult): GatewayTask {
    const evidenceIds = routeResult.logs.map((summary, index) => this.options.gatewayTasks.appendEvidence({
      taskId: gatewayTask.id,
      gatewayId: gatewayTask.gatewayId,
      delegatedTargetId: gatewayTask.delegatedTargetId,
      adapter: gatewayTask.adapter,
      forwardingGrantId: gatewayTask.forwardingGrant?.id,
      delegatedAgentId: gatewayTask.forwardingGrant?.delegatedAgentId,
      executionRunId: gatewayTask.executionRunId,
      stepId: gatewayTask.stepId,
      action: gatewayTask.action,
      result: routeResult.success ? 'success' : 'failed',
      evidenceRef: `audit://gateway-route/${gatewayTask.id}/${index + 1}`,
      sequence: index + 1,
      kind: routeResult.kind,
      summary,
      metadata: routeResult.detail,
    }).id);
    void this.submitEvidenceLogs(agentTask, gatewayTask.id);
    return this.options.gatewayTasks.result(gatewayTask.id, leaseId, {
      success: routeResult.success,
      status: routeResult.success ? 'success' : 'failed',
      summary: routeResult.summary,
      evidenceIds,
      errorCode: routeResult.success ? undefined : routeResult.errorCode,
      errorMessage: routeResult.success ? undefined : routeResult.summary,
    });
  }

  private async submitEvidenceLogs(agentTask: AgentTaskEnvelope, gatewayTaskId: string): Promise<void> {
    const evidences = this.options.gatewayTasks.listEvidence(gatewayTaskId)
      .filter((evidence) => evidence.kind === 'log' || evidence.kind === 'command_summary' || evidence.kind === 'response_summary')
      .filter((evidence) => (evidence.sequence ?? 0) > 0);
    if (!evidences.length) return;
    const ack = await this.options.agents.submitLogs(this.options.tenantId, {
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

  private async submitAgentResult(agentTask: AgentTaskEnvelope, leaseId: string, completed: GatewayTask, success: boolean): Promise<void> {
    await this.options.agents.submitResult(this.options.tenantId, {
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

  private async findRecoverableAgentTask(gatewayTask: GatewayTask): Promise<AgentTaskEnvelope | undefined> {
    const queue = await this.options.agents.listTaskQueue(this.options.tenantId, this.options.agentId);
    return queue.tasks.find((task) => isGatewayTaskRun(task)
      && (task.payload.gatewayTask as GatewayTask).id === gatewayTask.id
      && ['queued', 'leased', 'acked'].includes(task.status));
  }
  private evaluateGatewayRouteTask(task: GatewayTask): GatewayRouteProcessResult {
    try {
      const grant = this.grants.validate(task.forwardingGrant, {
        gatewayId: task.gatewayId,
        delegatedTargetId: task.delegatedTargetId,
        taskType: task.action,
        routeChannel: task.adapter,
        executionRunId: task.executionRunId,
        stepId: task.stepId,
      });
      const consumed = this.grants.consume(grant);
      this.options.gatewayTasks.updateForwardingGrant(task.id, consumed);
      task.forwardingGrant = consumed;
      return evaluateGatewayRouteTask(task, consumed.id);
    } catch (error) {
      return {
        success: false,
        summary: error instanceof Error ? error.message : String(error),
        errorCode: 'GATEWAY_FORWARDING_GRANT_DENIED',
        kind: 'log',
        logs: ['ForwardingGrant 校验失败，拒绝 Gateway 转发'],
        detail: {
          mode: 'gateway.forwarding_grant.denied',
          errorCode: error instanceof Error && 'errorCode' in error ? (error as { errorCode?: string }).errorCode : 'GATEWAY_FORWARDING_GRANT_DENIED',
        },
      };
    }
  }
}

function isGatewayTaskRun(task: AgentTaskEnvelope): boolean {
  return (task.payload.type === 'gateway.probe'
    || task.payload.type === 'gateway.forward.agent_task'
    || task.payload.type === 'gateway.forward.direct_control') && Boolean(task.payload.gatewayTask);
}

interface GatewayRouteProcessResult {
  success: boolean;
  summary: string;
  errorCode?: string;
  kind: 'log' | 'response_summary';
  logs: string[];
  detail: Record<string, unknown>;
}

function evaluateGatewayRouteTask(task: GatewayTask, forwardingGrantId: string): GatewayRouteProcessResult {
  if (task.action === 'gateway.probe') {
    return {
      success: true,
      summary: 'Gateway probe 已由区域路由任务处理',
      kind: 'response_summary',
      logs: [`gateway.probe ${task.delegatedTargetId} via ${task.adapter}`],
      detail: { mode: 'gateway.probe', routeChannel: task.adapter, delegatedTargetId: task.delegatedTargetId, forwardingGrantId },
    };
  }
  if (task.action === 'gateway.forward.agent_task' || task.action === 'gateway.forward.direct_control') {
    return {
      success: true,
      summary: 'Gateway forward 已完成路由包装',
      kind: 'log',
      logs: [`${task.action} ${task.delegatedTargetId} via ${task.adapter}`],
      detail: { mode: task.action, routeChannel: task.adapter, delegatedTargetId: task.delegatedTargetId, forwardingGrantId },
    };
  }
  return {
    success: false,
    summary: `不支持的 Gateway 路由任务: ${task.action}`,
    errorCode: 'GATEWAY_ROUTE_TASK_UNSUPPORTED',
    kind: 'log',
    logs: [`unsupported gateway route task ${task.action}`],
    detail: { mode: 'gateway.route.unsupported', action: task.action },
  };
}
