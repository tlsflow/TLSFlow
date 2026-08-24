import { AppError } from '../../../common/errors/app-error.js';
import type { AgentDirectControlState, AgentRegistration } from '../schema/agents.schema.js';

export interface AgentDirectDiscoveryRequest {
  providerTypes?: string[];
  scope?: string;
  includeBindings?: boolean;
  requestId?: string;
}

export interface AgentDirectDiscoveryPayload {
  collectedAt: string;
  source: string;
  platform: string;
  hosts?: Array<Record<string, unknown>>;
  services?: Array<Record<string, unknown>>;
  serviceAssets?: Array<Record<string, unknown>>;
  siteAssets?: Array<Record<string, unknown>>;
  bindings?: Array<Record<string, unknown>>;
}

export interface AgentDirectDiscoveryResult {
  directControl: AgentDirectControlState;
  payload: AgentDirectDiscoveryPayload;
}

export interface AgentDirectActionExecuteRequest {
  actionType: string;
  inputs: Record<string, unknown>;
  requestId?: string;
}

export interface AgentDirectActionExecuteResult {
  directControl: AgentDirectControlState;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, unknown>;
  taskId?: string;
}

export class AgentDirectClient {
  async runDiscovery(agent: AgentRegistration, request: AgentDirectDiscoveryRequest): Promise<AgentDirectDiscoveryResult> {
    const directControl = requireReachableDirectControl(agent, 'discovery.run');
    const baseUrl = buildDirectControlBaseUrl(directControl.listenAddress!);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/control/discovery/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': request.requestId ?? 'agent-direct-discovery',
        },
        body: JSON.stringify({
          providerTypes: request.providerTypes ?? [],
          scope: request.scope ?? 'full',
          includeBindings: request.includeBindings !== false,
          requestId: request.requestId,
        }),
      });
    } catch (error) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连发现连接失败', {
        agentId: agent.id,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      const body = await safeReadJson(response);
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连发现请求失败', {
        agentId: agent.id,
        statusCode: response.status,
        response: body,
      });
    }
    const body = await safeReadJson(response) as AgentDirectDiscoveryPayload;
    if (!body || typeof body !== 'object') {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'Agent 直连发现返回无效响应', { agentId: agent.id });
    }
    return {
      directControl,
      payload: body,
    };
  }

  async executeAction(agent: AgentRegistration, request: AgentDirectActionExecuteRequest): Promise<AgentDirectActionExecuteResult> {
    const actionType = request.actionType.trim();
    const directControl = requireReachableDirectControl(agent, actionType);
    const baseUrl = buildDirectControlBaseUrl(directControl.listenAddress!);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/control/actions/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': request.requestId ?? `agent-direct-action:${actionType}`,
        },
        body: JSON.stringify({
          actionType,
          inputs: request.inputs ?? {},
          requestId: request.requestId,
        }),
      });
    } catch (error) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连执行连接失败', {
        agentId: agent.id,
        actionType,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const body = await safeReadJson(response) as Record<string, unknown> | undefined;
    if (!response.ok && (!body || typeof body !== 'object')) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连执行请求失败', {
        agentId: agent.id,
        actionType,
        statusCode: response.status,
      });
    }
    return {
      directControl,
      success: body?.success === true,
      errorCode: typeof body?.errorCode === 'string' ? body.errorCode : undefined,
      errorMessage: typeof body?.errorMessage === 'string' ? body.errorMessage : undefined,
      detail: readRecord(body?.detail),
      taskId: typeof body?.taskId === 'string' ? body.taskId : undefined,
    };
  }
}

function requireReachableDirectControl(agent: AgentRegistration, action: string): AgentDirectControlState {
  const directControl = agent.directControl;
  if (!directControl?.enabled) {
    throw new AppError('VALIDATION_FAILED', 'Agent 未启用直连控制', { agentId: agent.id });
  }
  if (!directControl.reachable) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连控制当前不可达', { agentId: agent.id });
  }
  if (!directControl.listenAddress) {
    throw new AppError('VALIDATION_FAILED', 'Agent 直连控制缺少监听地址', { agentId: agent.id });
  }
  if (!directControl.supportedActions.includes(action)) {
    throw new AppError('CAPABILITY_MISSING', `Agent 未声明 ${action} 能力`, {
      agentId: agent.id,
      action,
      supportedActions: directControl.supportedActions,
    });
  }
  return directControl;
}

function buildDirectControlBaseUrl(listenAddress: string): string {
  const normalized = listenAddress.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', 'Agent 直连监听地址为空');
  return `http://${normalized}`;
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
