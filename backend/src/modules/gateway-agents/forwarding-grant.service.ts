import { AppError } from '../../common/errors/app-error.js';
import { newId } from '../../shared/id.js';
import type { ForwardingGrant, GatewayAdapterType, GatewayTaskType } from './gateway-agent.types.js';

export interface IssueForwardingGrantInput {
  gatewayId: string;
  delegatedTargetId: string;
  delegatedAgentId?: string;
  taskType: GatewayTaskType;
  routeChannel: GatewayAdapterType;
  executionRunId: string;
  stepId: string;
  ttlSeconds?: number;
  maxUses?: number;
  now?: Date;
}

export class ForwardingGrantService {
  issue(input: IssueForwardingGrantInput): ForwardingGrant {
    const now = input.now ?? new Date();
    const ttlSeconds = normalizeTtl(input.ttlSeconds ?? 900);
    const maxUses = normalizeUses(input.maxUses ?? 1);
    return {
      id: newId('fwgrt'),
      gatewayId: input.gatewayId,
      delegatedTargetId: input.delegatedTargetId,
      delegatedAgentId: input.delegatedAgentId,
      taskType: input.taskType,
      routeChannel: input.routeChannel,
      executionRunId: input.executionRunId,
      stepId: input.stepId,
      maxUses,
      remainingUses: maxUses,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      status: 'active',
      issuedAt: now.toISOString(),
    };
  }

  validate(grant: ForwardingGrant | undefined, expected: {
    gatewayId: string;
    delegatedTargetId: string;
    taskType: GatewayTaskType | string;
    routeChannel: GatewayAdapterType;
    executionRunId: string;
    stepId: string;
    now?: Date;
  }): ForwardingGrant {
    if (!grant) throw new AppError('AUTH_FORBIDDEN', 'Gateway 转发缺少 ForwardingGrant', { reason: 'GATEWAY_FORWARDING_GRANT_REQUIRED' });
    const now = expected.now ?? new Date();
    if (grant.status !== 'active') throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 不可用', { reason: 'GATEWAY_FORWARDING_GRANT_DENIED', grantId: grant.id, status: grant.status });
    if (new Date(grant.expiresAt).getTime() <= now.getTime()) throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 已过期', { reason: 'GATEWAY_FORWARDING_GRANT_EXPIRED', grantId: grant.id });
    if (grant.remainingUses <= 0) throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 使用次数已耗尽', { reason: 'GATEWAY_FORWARDING_GRANT_DENIED', grantId: grant.id });
    if (grant.gatewayId !== expected.gatewayId
      || grant.delegatedTargetId !== expected.delegatedTargetId
      || grant.taskType !== expected.taskType
      || grant.routeChannel !== expected.routeChannel
      || grant.executionRunId !== expected.executionRunId
      || grant.stepId !== expected.stepId) {
      throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 与当前转发任务不匹配', {
        reason: 'GATEWAY_FORWARDING_GRANT_DENIED',
        grantId: grant.id,
        expected,
      });
    }
    return grant;
  }

  consume(grant: ForwardingGrant, now = new Date()): ForwardingGrant {
    this.validate(grant, {
      gatewayId: grant.gatewayId,
      delegatedTargetId: grant.delegatedTargetId,
      taskType: grant.taskType,
      routeChannel: grant.routeChannel,
      executionRunId: grant.executionRunId,
      stepId: grant.stepId,
      now,
    });
    const remainingUses = grant.remainingUses - 1;
    return {
      ...grant,
      remainingUses,
      status: remainingUses <= 0 ? 'used' : 'active',
      usedAt: now.toISOString(),
    };
  }
}

function normalizeTtl(value: number): number {
  if (!Number.isInteger(value) || value < 30 || value > 3600) throw new AppError('VALIDATION_FAILED', 'ForwardingGrant ttlSeconds 必须在 30-3600 秒之间', { ttlSeconds: value });
  return value;
}

function normalizeUses(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new AppError('VALIDATION_FAILED', 'ForwardingGrant maxUses 必须在 1-10 之间', { maxUses: value });
  return value;
}
