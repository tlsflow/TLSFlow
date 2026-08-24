import { sign, type KeyObject } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import type { AgentRegistration } from '../schema/agents.schema.js';

export interface AgentUpgradeEnvelope {
  schemaVersion: 'management.upgrade.v1';
  planId: string;
  transactionId: string;
  agentId: string;
  /** 使用与手工安装相同的 bootstrap 安装入口完成成套升级。 */
  upgradeBootstrapUrl?: string;
  release: {
    releaseId: string;
    productLine: 'windows-go-full' | 'linux-go-full';
    version: string;
    platform: 'windows' | 'linux';
    architecture: 'amd64' | 'arm64';
    downloadUrl: string;
    artifactSha256: string;
    artifactSize: number;
    signatureKeyId: string;
    artifactSignature: string;
  };
  policyRef: string;
  approvalRef: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  authorityKeyId: string;
  controlPlaneSignature: string;
}

export interface AgentManagementResponse {
  success?: boolean;
  accepted?: boolean;
  transactionId?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

export interface AgentUpgradeStatusResponse {
  schemaVersion?: string;
  planId?: string;
  transactionId?: string;
  agentId?: string;
  fromVersion?: string;
  targetVersion?: string;
  artifactSha256?: string;
  phase?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  updatedAt?: string;
  observedAt?: string;
  [key: string]: unknown;
}

export function signAgentUpgradeEnvelope(input: Omit<AgentUpgradeEnvelope, 'controlPlaneSignature'>, privateKey: KeyObject): AgentUpgradeEnvelope {
  const unsigned = {
    schemaVersion: input.schemaVersion,
    planId: input.planId,
    transactionId: input.transactionId,
    agentId: input.agentId,
    ...(input.upgradeBootstrapUrl ? { upgradeBootstrapUrl: input.upgradeBootstrapUrl } : {}),
    release: input.release,
    policyRef: input.policyRef,
    approvalRef: input.approvalRef,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    authorityKeyId: input.authorityKeyId,
  };
  return {
    ...input,
    controlPlaneSignature: sign(null, Buffer.from(canonicalize(unsigned), 'utf8'), privateKey).toString('base64url'),
  };
}

type Fetcher = typeof fetch;

/**
 * Go Full Agent 升级专用管理客户端。它只调用 Agent 管理端口，不会把请求转换成
 * Agent task，也不会在传输失败时切换到 SSH、CURL 或 Gateway Relay。
 */
export class AgentManagementClient {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async dispatchUpgrade(agent: AgentRegistration, envelope: AgentUpgradeEnvelope): Promise<AgentManagementResponse> {
    const body = await this.request(agent, '/api/v1/control/upgrade', 'POST', envelope);
    // Agent 返回活动旧事务时，transactionId 指向冲突事务是有意义的证据，不能先被通用身份校验吞掉。
    if (body.errorCode === 'AGENT_UPGRADE_CONFLICT') return body;
    assertResponseIdentity(body, envelope.transactionId, agent.id);
    return body;
  }

  async getUpgradeStatus(agent: AgentRegistration, transactionId: string): Promise<AgentUpgradeStatusResponse> {
    const body = await this.request(agent, `/api/v1/control/upgrade/status?transactionId=${encodeURIComponent(transactionId)}`, 'GET');
    if (body.transactionId !== transactionId) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 返回了不匹配的升级事务状态', {
        agentId: agent.id,
        expectedTransactionId: transactionId,
        actualTransactionId: body.transactionId,
        reason: 'AGENT_UPGRADE_RESPONSE_IDENTITY_MISMATCH',
      });
    }
    return body as AgentUpgradeStatusResponse;
  }

  private async request(agent: AgentRegistration, path: string, method: 'GET' | 'POST', payload?: unknown): Promise<AgentManagementResponse> {
    const endpoint = agent.descriptor.managementEndpoint;
    if (!endpoint) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 未提供管理端点，不能执行本地升级', {
        agentId: agent.id,
        reason: 'MANAGEMENT_ENDPOINT_MISSING',
      });
    }
    let url: URL;
    try {
      url = new URL(path, `${endpoint}/`);
    } catch {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 管理端点地址无效', { agentId: agent.id, reason: 'MANAGEMENT_ENDPOINT_INVALID' });
    }
    const raw = await requestWithFetcher(this.fetcher, url, method, payload, this.timeoutMs);
    const body = parseBody(raw.bodyText);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '调用 Agent 升级管理端点失败', {
        agentId: agent.id,
        statusCode: raw.statusCode,
        reason: raw.statusCode === 0 ? 'AGENT_UPGRADE_CONNECT_FAILED' : 'AGENT_UPGRADE_HTTP_FAILED',
        response: typeof body === 'string' ? body.slice(0, 500) : body,
      });
    }
    return body as AgentManagementResponse;
  }
}

function assertResponseIdentity(body: AgentManagementResponse, transactionId: string, agentId: string): void {
  if (body.transactionId && body.transactionId !== transactionId) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 返回了不匹配的升级事务响应', {
      agentId,
      expectedTransactionId: transactionId,
      actualTransactionId: body.transactionId,
      reason: 'AGENT_UPGRADE_RESPONSE_IDENTITY_MISMATCH',
    });
  }
}

async function requestWithFetcher(fetcher: Fetcher, url: URL, method: 'GET' | 'POST', payload: unknown, timeoutMs: number): Promise<{ statusCode: number; bodyText: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method,
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: abort.signal,
    });
    return { statusCode: response.status, bodyText: await response.text() };
  } catch (error) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '调用 Agent 升级管理端点失败', {
      reason: abort.signal.aborted ? 'AGENT_UPGRADE_TIMEOUT' : 'AGENT_UPGRADE_CONNECT_FAILED',
      timeoutMs,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
