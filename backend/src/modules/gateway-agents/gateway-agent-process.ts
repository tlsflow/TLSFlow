import { AppError } from '../../common/errors/app-error.js';
import { gatewayRelayOnlyError } from './gateway-agent.types.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import { ForwardingGrantService } from './forwarding-grant.service.js';
import { FailClosedGatewayAgentV2Forwarder, GatewayTaskReplayGuard, GatewayV2ForwardingService, type GatewayV2ReplayGuardPort } from './gateway-v2-forwarding.service.js';
import type { GatewayAgentV2ForwardRequest, GatewayAgentV2Forwarder, GatewayTask } from './gateway-agent.types.js';
import { GatewayTaskService } from './gateway-task.service.js';

export interface GatewayAgentProcessOptions {
  tenantId: string;
  agentId: string;
  agents: AgentsApplicationService;
  gatewayTasks: GatewayTaskService;
  grants?: ForwardingGrantService;
  /** 未注入时 Gateway 只失败关闭，不允许使用本地合成路由。 */
  forwarder?: GatewayAgentV2Forwarder;
  replayGuard?: GatewayV2ReplayGuardPort;
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
  private readonly forwarder: GatewayAgentV2Forwarder;
  private readonly replayGuard: GatewayV2ReplayGuardPort;
  private readonly v2Forwarding = new GatewayV2ForwardingService();

  constructor(private readonly options: GatewayAgentProcessOptions) {
    void options;
    throw gatewayRelayOnlyError('GatewayAgentProcess.constructor');
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

    let authorizationCommitted = false;
    let forwardRequest: GatewayAgentV2ForwardRequest | undefined;
    try {
      this.options.gatewayTasks.ack(gatewayTask.id, leaseId);
      this.options.gatewayTasks.markRunning(gatewayTask.id, leaseId);
      const current = this.options.gatewayTasks.get(gatewayTask.id)!;
      if (current.result) {
        await this.submitAgentResult(agentTask, leaseId, current, current.result.success);
        return { success: current.result.success };
      }

      // 已消费的单次授权说明之前可能已经把写入送出；恢复时只能记录 UNKNOWN，绝不能重放。
      if (current.forwardingGrant?.status === 'used') {
        const completed = this.recordGatewayResult(agentTask, gatewayTask, leaseId, {
          success: false,
          executionStatus: 'UNKNOWN',
          summary: 'Gateway 进程在 Agent v2 结果落盘前崩溃，禁止重放，写入结果不明',
          errorCode: 'GATEWAY_EXECUTION_UNKNOWN',
          kind: 'log',
          logs: ['Gateway v2 recovery stopped: forwarding grant already consumed'],
          detail: { mode: 'gateway.v2.recovery_unknown', executionStatus: 'UNKNOWN', forwardingGrantId: current.forwardingGrant.id },
        });
        await this.submitAgentResult(agentTask, leaseId, completed, false);
        return { success: false };
      }

      forwardRequest = this.v2Forwarding.prepare(gatewayTask, this.options.tenantId, `gateway-v2:${gatewayTask.id}`, new Date());
      const replayBinding = { tenantId: forwardRequest.tenantId, agentId: forwardRequest.token.agentId, tokenId: forwardRequest.token.tokenId, nonce: forwardRequest.token.nonce, revocationRef: forwardRequest.policyDecision.revocationRef, taskId: gatewayTask.id };
      this.replayGuard.assertAvailable(replayBinding);
      const grant = this.grants.validate(forwardRequest.forwardingGrant, {
        gatewayId: gatewayTask.gatewayId,
        delegatedTargetId: gatewayTask.delegatedTargetId,
        taskType: gatewayTask.action,
        routeChannel: gatewayTask.adapter,
        executionRunId: gatewayTask.executionRunId,
        stepId: gatewayTask.stepId,
      });
      const consumed = this.grants.consume(grant);
      // Nonce 与单次 ForwardingGrant 必须作为同一 GatewayTask 状态提交，避免先消费 Grant 再消费 Nonce 造成半提交。
      this.replayGuard.consume(replayBinding, consumed);
      const updated = this.options.gatewayTasks.get(gatewayTask.id);
      if (!updated?.forwardingGrant || updated.forwardingGrant.status !== 'used' || !updated.v2NonceBinding) {
        throw new AppError('SYSTEM_INTERNAL_ERROR', 'Gateway v2 授权材料未完成原子提交');
      }
      gatewayTask.forwardingGrant = updated.forwardingGrant;
      authorizationCommitted = true;

      const forwarded = this.v2Forwarding.validateResult(forwardRequest, await this.forwarder.forward({ ...forwardRequest, forwardingGrant: consumed }));
      const reportedStatus = forwarded.receipt?.status ?? 'SUCCESS';
      // 写入动作一旦离开 Gateway，任何非成功结果都不能再被当作可重试的普通失败。
      const executionStatus = forwardRequest.actionType === 'agent.plan.execute' && reportedStatus !== 'SUCCESS' ? 'UNKNOWN' : reportedStatus;
      const completed = this.recordGatewayResult(agentTask, gatewayTask, leaseId, {
        success: executionStatus === 'SUCCESS',
        executionStatus,
        summary: executionStatus === 'SUCCESS' ? 'Agent v2 已返回真实授权结果' : `Agent v2 返回 ${executionStatus}`,
        errorCode: executionStatus === 'SUCCESS' ? undefined : executionStatus === 'UNKNOWN' ? 'GATEWAY_EXECUTION_UNKNOWN' : 'AGENT_V2_EXECUTION_FAILED',
        kind: 'response_summary',
        logs: [`${forwardRequest.actionType} ${gatewayTask.delegatedTargetId} via ${gatewayTask.adapter}`],
        detail: {
          mode: 'gateway.v2.forward',
          actionType: forwardRequest.actionType,
          tenantId: forwardRequest.tenantId,
          delegatedAgentId: forwardRequest.token.agentId,
          pluginId: forwardRequest.token.pluginId,
          pluginVersionId: forwardRequest.token.pluginVersionId,
          planDigest: forwardRequest.token.planDigest,
          tokenId: forwardRequest.token.tokenId,
          nonce: forwardRequest.token.nonce,
          revocationRef: forwardRequest.policyDecision.revocationRef,
          grantId: forwardRequest.grant.grantId,
          forwardingGrantId: forwardRequest.forwardingGrant.id,
          receipt: forwarded.receipt,
          ...(forwarded.detail ?? {}),
        },
        receipt: forwarded.receipt,
      });
      await this.submitAgentResult(agentTask, leaseId, completed, completed.result?.success ?? false);
      return { success: completed.result?.success ?? false };
    } catch (error) {
      const errorDetails = error instanceof AppError && error.details && typeof error.details === 'object' && !Array.isArray(error.details)
        ? error.details as Record<string, unknown>
        : undefined;
      if (authorizationCommitted && forwardRequest && errorDetails?.reason === 'GATEWAY_LATE_RECEIPT') {
        this.options.gatewayTasks.recordLateV2Response(gatewayTask.id, leaseId, forwardRequest.requestId, {
          errorCode: error instanceof AppError ? error.errorCode : 'GATEWAY_LATE_RECEIPT',
          message: error instanceof Error ? error.message : String(error),
          actionType: forwardRequest.actionType,
          grantId: forwardRequest.grant.grantId,
          tokenId: forwardRequest.token.tokenId,
          nonce: forwardRequest.token.nonce,
        });
      }
      const status = authorizationCommitted ? 'unknown' : 'failed';
      const failed = this.options.gatewayTasks.result(gatewayTask.id, leaseId, {
        success: false,
        status,
        executionStatus: authorizationCommitted ? 'UNKNOWN' : 'FAILED',
        summary: authorizationCommitted ? 'Agent v2 转发失败、超时或结果不明，禁止重放，写入状态为 UNKNOWN' : error instanceof Error ? error.message : String(error),
        errorCode: authorizationCommitted ? 'GATEWAY_EXECUTION_UNKNOWN' : error instanceof AppError ? error.errorCode : 'GATEWAY_AGENT_PROCESS_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.options.agents.submitResult(this.options.tenantId, {
        agentId: this.options.agentId,
        taskId: agentTask.id,
        leaseId,
        success: false,
        errorCode: failed.result?.errorCode,
        errorMessage: failed.result?.errorMessage,
        detail: {
          mode: 'gateway_agent_process',
          gatewayTaskId: failed.id,
          gatewayTaskStatus: failed.status,
          executionStatus: failed.result?.executionStatus ?? 'FAILED',
          gatewayResult: toGatewayCoordinationResult(failed),
        },
      });
      return { success: false };
    } finally {
      await this.options.gatewayTasks.flushPersistence();
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
      result: routeResult.executionStatus === 'UNKNOWN' ? 'unknown' : routeResult.success ? 'success' : 'failed',
      evidenceRef: `audit://gateway-route/${gatewayTask.id}/${index + 1}`,
      sequence: index + 1,
      kind: routeResult.kind,
      summary,
      metadata: routeResult.detail,
    }).id);
    void this.submitEvidenceLogs(agentTask, gatewayTask.id);
    return this.options.gatewayTasks.result(gatewayTask.id, leaseId, {
      success: routeResult.success,
      status: routeResult.executionStatus === 'UNKNOWN' ? 'unknown' : routeResult.success ? 'success' : 'failed',
      summary: routeResult.summary,
      evidenceIds,
      errorCode: routeResult.success ? undefined : routeResult.errorCode,
      errorMessage: routeResult.success ? undefined : routeResult.summary,
      executionStatus: routeResult.executionStatus,
      receipt: routeResult.receipt,
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
        executionStatus: completed.result?.executionStatus,
        gatewayResult: toGatewayCoordinationResult(completed),
        receipt: completed.result?.receipt,
        gatewayV2: completed.payload,
      },
    });
  }

  private async findRecoverableAgentTask(gatewayTask: GatewayTask): Promise<AgentTaskEnvelope | undefined> {
    const queue = await this.options.agents.listTaskQueue(this.options.tenantId, this.options.agentId);
    return queue.tasks.find((task) => isGatewayTaskRun(task)
      && (task.payload.gatewayTask as GatewayTask).id === gatewayTask.id
      && ['queued', 'leased', 'acked'].includes(task.status));
  }
}

function toGatewayCoordinationResult(task: GatewayTask): Record<string, unknown> {
  return {
    taskId: task.id,
    status: task.status,
    success: task.result?.success === true,
    executionStatus: task.result?.executionStatus,
    summary: task.result?.summary,
    evidenceIds: task.result?.evidenceIds ?? [],
    finishedAt: task.result?.finishedAt,
    forwarded: task.forwardingGrant?.status === 'used',
  };
}

function isGatewayTaskRun(task: AgentTaskEnvelope): boolean {
  return Boolean(task.payload.gatewayTask);
}

interface GatewayRouteProcessResult {
  success: boolean;
  executionStatus: 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
  summary: string;
  errorCode?: string;
  kind: 'log' | 'response_summary';
  logs: string[];
  detail: Record<string, unknown>;
  receipt?: import('../agents/security/agent-security.contract.js').AgentExecutionReceiptV1;
}
