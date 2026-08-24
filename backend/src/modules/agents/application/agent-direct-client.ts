import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../schema/agents.schema.js';
import type { AgentV2ContractType } from '../security/agent-security.contract.js';

/**
 * Agent 直连客户端已退役。
 *
 * Agent v2 任务必须写入控制面队列，由 Agent 拉取、确认、执行并提交 Receipt。
 * 这里保留窄拒绝器，防止旧调用方通过重新实例化客户端重新打开 HTTP 旁路。
 */
export class AgentDirectClient {
  async executeAction(
    agent: AgentRegistration,
    request: { actionType: AgentV2ContractType; inputs: Record<string, unknown>; requestId?: string },
  ): Promise<never> {
    void agent;
    void request;
    throw new AppError('AUTH_FORBIDDEN', 'Agent 直连执行旁路已退役，必须使用 Agent v2 控制面队列', {
      reason: 'AGENT_DIRECT_BYPASS_RETIRED',
      fallback: false,
    });
  }
}
