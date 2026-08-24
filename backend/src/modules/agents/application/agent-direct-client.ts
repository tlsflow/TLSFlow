import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../schema/agents.schema.js';

/**
 * Agent 管理端口的窄直连客户端。
 *
 * 只允许手动 Web 重新发现使用该路径。部署、写入操作和 Gateway 转发仍必须
 * 使用 Agent 任务队列，不能借此绕过租约、回执和恢复机制。
 */
export class AgentDirectClient {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 60_000,
  ) {}

  async refreshWebInventory(
    agent: AgentRegistration,
    request: { requestId: string; payload: Record<string, unknown> },
  ): Promise<AgentDirectDiscoveryResponse> {
    const endpoint = agent.descriptor.managementEndpoint;
    if (!endpoint) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 未提供管理端点，不能直接重新发现', {
        agentId: agent.id,
        reason: 'MANAGEMENT_ENDPOINT_MISSING',
      });
    }

    const url = new URL('/api/v1/control/discovery', `${endpoint}/`);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.payload),
        signal: abort.signal,
      });
      const body = await parseResponse(response);
      if (response.ok && body.success === true) return body;
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', body.errorMessage || 'Agent 直接重新发现失败', {
        agentId: agent.id,
        requestId: request.requestId,
        statusCode: response.status,
        errorCode: body.errorCode ?? 'AGENT_DIRECT_DISCOVERY_FAILED',
        detail: body.detail,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '调用 Agent 管理端点失败', {
        agentId: agent.id,
        requestId: request.requestId,
        reason: error instanceof Error && error.name === 'AbortError' ? 'AGENT_DIRECT_DISCOVERY_TIMEOUT' : 'AGENT_DIRECT_DISCOVERY_CONNECT_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface AgentDirectDiscoveryResponse {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, unknown>;
}

async function parseResponse(response: Response): Promise<AgentDirectDiscoveryResponse> {
  const text = await response.text();
  if (!text.trim()) return { success: false, errorMessage: `Agent 返回 HTTP ${response.status}` };
  try {
    const value = JSON.parse(text) as AgentDirectDiscoveryResponse;
    return value && typeof value === 'object' ? value : { success: false, errorMessage: 'Agent 返回无效 JSON' };
  } catch {
    return { success: false, errorMessage: text.slice(0, 500) };
  }
}
