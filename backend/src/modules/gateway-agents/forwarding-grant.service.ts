import { AppError } from '../../common/errors/app-error.js';
import { newId } from '../../shared/id.js';
import { gatewayRelayOnlyError, type ForwardingGrant, type GatewayAdapterType, type GatewayTaskType } from './gateway-agent.types.js';

export interface IssueForwardingGrantInput {
  gatewayId: string;
  delegatedTargetId: string;
  delegatedAgentId?: string;
  tenantId?: string;
  taskType: GatewayTaskType;
  routeChannel: GatewayAdapterType;
  executionRunId: string;
  stepId: string;
  ttlSeconds?: number;
  maxUses?: number;
  now?: Date;
}

export interface ValidateV2ForwardingGrantInput {
  gatewayId: string;
  delegatedTargetId: string;
  delegatedAgentId: string;
  tenantId: string;
  taskType: GatewayTaskType | string;
  routeChannel: GatewayAdapterType;
  executionRunId: string;
  stepId: string;
  now?: Date;
}

export class ForwardingGrantService {
  issue(input: IssueForwardingGrantInput): ForwardingGrant {
    void input;
    throw gatewayRelayOnlyError('ForwardingGrantService.issue');
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
    void grant;
    void expected;
    throw gatewayRelayOnlyError('ForwardingGrantService.validate');
  }

  /**
   * Agent v2 只接受租户、目标 Agent 和执行步骤都固定的单次 Grant。
   * 普通 Gateway 记录仍可使用 validate()，但不能借此进入 Agent v2 主链。
   */
  validateV2(grant: ForwardingGrant | undefined, expected: ValidateV2ForwardingGrantInput): ForwardingGrant {
    const validated = this.validate(grant, expected);
    if (validated.tenantId !== expected.tenantId
      || validated.delegatedAgentId !== expected.delegatedAgentId
      || validated.maxUses !== 1
      || validated.remainingUses !== 1) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent v2 只允许绑定租户、目标 Agent 和单次使用 Grant', {
        reason: 'GATEWAY_V2_FORWARDING_GRANT_BINDING_DENIED',
        grantId: validated.id,
      });
    }
    return validated;
  }

  consume(grant: ForwardingGrant, now = new Date()): ForwardingGrant {
    void grant;
    void now;
    throw gatewayRelayOnlyError('ForwardingGrantService.consume');
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
