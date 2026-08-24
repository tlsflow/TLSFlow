import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { AgentStatuses } from '../../../shared/enums/core.enums.js';
import { AgentsApplicationService } from '../application/agents.application-service.js';
import type { AckAgentTaskInput, AgentCapabilitySnapshotInput, AgentHeartbeatInput, CheckAgentUpgradeInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, DisableAgentInput, EnqueueAgentTaskInput, PublishAgentVersionInput, RegisterAgentInput, SubmitAgentTaskLogInput, SubmitAgentTaskResultInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentTaskEnvelope } from '../schema/agents.schema.js';

const tags = ['Agents'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class AgentsController {
  constructor(private readonly service = new AgentsApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/agents', '查询 Agent 列表', tags, (request) => this.listAgents(request));
    router.get('/api/v1/agents/detail', '查询 Agent 详情聚合', tags, (request) => this.getAgentDetail(request));
    router.get('/api/v1/agents/capabilities', '查询 Agent 能力快照', tags, (request) => this.getCapabilities(request));
    router.get('/api/v1/agents/tasks', '查询 Agent 任务队列', tags, (request) => this.listTaskQueue(request));
    router.get('/api/v1/agents/upgrades/suggestion', '查询 Agent 升级建议', tags, (request) => this.getUpgradeSuggestion(request));
    router.post('/api/v1/agents/enrollment-tokens', '创建 Agent 注册令牌', tags, (request) => this.createEnrollmentToken(request));
    router.post('/api/v1/agents/disable', '禁用 Agent', tags, (request) => this.disableAgent(request));
    router.post('/api/v1/agents/register', '注册 Agent', tags, (request) => this.registerAgent(request));
    router.post('/api/v1/agents/sessions', '创建 Agent mTLS 会话', tags, (request) => this.createSession(request));
    router.post('/api/v1/agents/heartbeat', 'Agent 心跳', tags, (request) => this.heartbeat(request));
    router.post('/api/v1/agents/capabilities', 'Agent 能力快照上报', tags, (request) => this.reportCapabilities(request));
    router.post('/api/v1/agents/tasks', '创建 Agent 任务', tags, (request) => this.enqueueTask(request));
    router.get('/api/v1/agents/tasks/pull', 'Agent 拉取任务', tags, (request) => this.pullTasks(request));
    router.post('/api/v1/agents/tasks/ack', 'Agent 确认任务', tags, (request) => this.ackTask(request));
    router.post('/api/v1/agents/tasks/logs', 'Agent 提交任务日志', tags, (request) => this.submitLog(request));
    router.get('/api/v1/agents/tasks/logs', '查询 Agent 任务日志', tags, (request) => this.listLogs(request));
    router.post('/api/v1/agents/tasks/result', 'Agent 提交任务结果', tags, (request) => this.submitResult(request));
    router.post('/api/v1/agents/versions', '发布 Agent 版本', tags, (request) => this.publishVersion(request));
    router.post('/api/v1/agents/upgrades/check', '检查 Agent 升级计划', tags, (request) => this.checkUpgrade(request));
    router.post('/api/v1/agents/upgrades/result', '提交 Agent 升级结果', tags, (request) => this.submitUpgradeResult(request));
  }

  getApplicationService(): AgentsApplicationService {
    return this.service;
  }

  private listAgents(request: HttpRequest) {
    return this.service.listAgents(tenantId(request), parsePageQuery(request.query, {
      allowedSortFields: ['agentKey', 'status', 'registeredAt', 'updatedAt'],
      allowedFilterFields: ['agentKey', 'status'],
    }));
  }

  private createEnrollmentToken(request: HttpRequest) {
    const body = validateObject(request.body, {
      allowedRoles: { type: 'array' },
      allowedZones: { type: 'array' },
      maxUses: { type: 'number' },
      ttlSeconds: { type: 'number' },
      createdBy: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.createEnrollmentToken(tenantId(request), { createdBy: actorId(request), ...body } as unknown as CreateEnrollmentTokenInput, requestId(request)) };
  }

  private getAgentDetail(request: HttpRequest) {
    return this.service.getAgentDetail(tenantId(request), readQuery(request, 'agentId'));
  }

  private getCapabilities(request: HttpRequest) {
    return this.service.getCapabilityProjection(tenantId(request), readQuery(request, 'agentId'));
  }

  private listTaskQueue(request: HttpRequest) {
    const statuses = readOptionalCsv(request, 'status');
    return this.service.listTaskQueue(tenantId(request), readQuery(request, 'agentId'), statuses as AgentTaskEnvelope['status'][] | undefined);
  }

  private getUpgradeSuggestion(request: HttpRequest) {
    return this.service.getUpgradeSuggestion(tenantId(request), readQuery(request, 'agentId'));
  }

  private disableAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      dryRun: { type: 'boolean' },
      reason: { type: 'string' },
      revokeCertificate: { type: 'boolean' },
    });
    if (body.dryRun) return { dryRun: true, status: 'DISABLED', agentId: body.agentId, reason: body.reason, revokeCertificate: Boolean(body.revokeCertificate) };
    return this.service.disableAgent(tenantId(request), {
      agentId: String(body.agentId),
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      revokeCertificate: Boolean(body.revokeCertificate),
      actorId: actorId(request),
    }, requestId(request));
  }

  private registerAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentKey: { type: 'string', required: true },
      hostname: { type: 'string', required: true },
      version: { type: 'string', required: true },
      osType: { type: 'string', required: true },
      arch: { type: 'string' },
      labels: { type: 'array' },
      enrollmentToken: { type: 'string' },
      role: { type: 'string' },
      zone: { type: 'string' },
      zoneIds: { type: 'array' },
      adapters: { type: 'array' },
      capabilities: { type: 'array' },
      resourceLimits: { type: 'object' },
      currentLoad: { type: 'number' },
      maxConcurrentTasks: { type: 'number' },
      successRate: { type: 'number' },
      certificateFingerprint: { type: 'string' },
      certificateExpiresAt: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.register(tenantId(request), body as unknown as RegisterAgentInput, requestId(request)) };
  }

  private createSession(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      certificateFingerprint: { type: 'string', required: true },
    });
    return { statusCode: 201, body: this.service.createMtlsSession(tenantId(request), body as unknown as CreateAgentSessionInput, requestId(request)) };
  }

  private heartbeat(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      status: { type: 'string', enum: AgentStatuses },
      version: { type: 'string', required: true },
      taskSummary: { type: 'object' },
      adapters: { type: 'array' },
      capabilities: { type: 'array' },
      resourceLimits: { type: 'object' },
      currentLoad: { type: 'number' },
      maxConcurrentTasks: { type: 'number' },
      successRate: { type: 'number' },
    });
    return this.service.heartbeat(tenantId(request), body as unknown as AgentHeartbeatInput, requestId(request));
  }

  private reportCapabilities(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      compatibilityLevel: { type: 'string' },
      capabilities: { type: 'array', required: true },
      adapters: { type: 'array' },
      resourceLimits: { type: 'object' },
      currentLoad: { type: 'number' },
      maxConcurrentTasks: { type: 'number' },
      successRate: { type: 'number' },
    });
    return { statusCode: 201, body: this.service.reportCapabilities(tenantId(request), body as unknown as AgentCapabilitySnapshotInput, requestId(request)) };
  }

  private enqueueTask(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      executionRunId: { type: 'string', required: true },
      executionStepId: { type: 'string', required: true },
      idempotencyKey: { type: 'string', required: true },
      payload: { type: 'object' },
    });
    return { statusCode: 201, body: this.service.enqueueTask(tenantId(request), body as unknown as EnqueueAgentTaskInput, requestId(request)) };
  }

  private pullTasks(request: HttpRequest) {
    const agentId = readQuery(request, 'agentId');
    const limit = Number(readQuery(request, 'limit', '10'));
    return this.service.pullTasks(tenantId(request), agentId, Number.isFinite(limit) ? limit : 10);
  }

  private ackTask(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      taskId: { type: 'string', required: true },
      leaseId: { type: 'string', required: true },
    });
    return this.service.ackTask(tenantId(request), body as unknown as AckAgentTaskInput);
  }

  private submitLog(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      taskId: { type: 'string', required: true },
      sequence: { type: 'number', required: true },
      level: { type: 'string' },
      message: { type: 'string', required: true },
      emittedAt: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.submitLog(tenantId(request), body as unknown as SubmitAgentTaskLogInput, requestId(request)) };
  }

  private listLogs(request: HttpRequest) {
    return this.service.listTaskLogs(tenantId(request), readQuery(request, 'taskId'));
  }

  private submitResult(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      taskId: { type: 'string', required: true },
      leaseId: { type: 'string', required: true },
      success: { type: 'boolean', required: true },
      errorCode: { type: 'string' },
      errorMessage: { type: 'string' },
      detail: { type: 'object' },
    });
    return this.service.submitResult(tenantId(request), body as unknown as SubmitAgentTaskResultInput);
  }

  private publishVersion(request: HttpRequest) {
    const body = validateObject(request.body, {
      version: { type: 'string', required: true },
      platform: { type: 'string', required: true },
      arch: { type: 'string' },
      minCompatibilityLevel: { type: 'string' },
      downloadUrl: { type: 'string', required: true },
      checksumSha256: { type: 'string', required: true },
      signature: { type: 'string', required: true },
      rollbackVersion: { type: 'string' },
      rolloutPercent: { type: 'number' },
      createdBy: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.publishVersion(tenantId(request), { createdBy: actorId(request), ...body } as unknown as PublishAgentVersionInput) };
  }

  private checkUpgrade(request: HttpRequest) {
    const body = validateObject(request.body, { agentId: { type: 'string', required: true } });
    return this.service.checkUpgrade(tenantId(request), body as unknown as CheckAgentUpgradeInput);
  }

  private submitUpgradeResult(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      planId: { type: 'string', required: true },
      success: { type: 'boolean', required: true },
      rolledBack: { type: 'boolean' },
      errorCode: { type: 'string' },
      errorMessage: { type: 'string' },
    });
    return this.service.submitUpgradeResult(tenantId(request), body as unknown as SubmitAgentUpgradeResultInput);
  }
}

export function getAgentsRouteContracts(): RouteContract[] {
  const schema = { type: 'object', additionalProperties: true };
  return [
    { method: 'GET', path: '/api/v1/agents', operationId: 'listAgents', summary: '查询 Agent 列表', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/agents/detail', operationId: 'getAgentDetail', summary: '查询 Agent 详情聚合', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/capabilities', operationId: 'getAgentCapabilities', summary: '查询 Agent 能力快照', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/tasks', operationId: 'listAgentTaskQueue', summary: '查询 Agent 任务队列', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/upgrades/suggestion', operationId: 'getAgentUpgradeSuggestion', summary: '查询 Agent 升级建议', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/enrollment-tokens', operationId: 'createAgentEnrollmentToken', summary: '创建 Agent 注册令牌', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/disable', operationId: 'disableAgent', summary: '禁用 Agent', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/register', operationId: 'registerAgent', summary: '注册 Agent', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/sessions', operationId: 'createAgentMtlsSession', summary: '创建 Agent mTLS 会话', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/heartbeat', operationId: 'heartbeatAgent', summary: 'Agent 心跳', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/capabilities', operationId: 'reportAgentCapabilities', summary: 'Agent 能力快照上报', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/tasks', operationId: 'enqueueAgentTask', summary: '创建 Agent 任务', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/tasks/pull', operationId: 'pullAgentTasks', summary: 'Agent 拉取任务', tags, responseSchema: { type: 'array', items: schema } },
    { method: 'POST', path: '/api/v1/agents/tasks/ack', operationId: 'ackAgentTask', summary: 'Agent 确认任务', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/tasks/logs', operationId: 'submitAgentTaskLog', summary: 'Agent 提交任务日志', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/tasks/logs', operationId: 'listAgentTaskLogs', summary: '查询 Agent 任务日志', tags, responseSchema: { type: 'array', items: schema } },
    { method: 'POST', path: '/api/v1/agents/tasks/result', operationId: 'submitAgentTaskResult', summary: 'Agent 提交任务结果', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/versions', operationId: 'publishAgentVersion', summary: '发布 Agent 版本', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/upgrades/check', operationId: 'checkAgentUpgrade', summary: '检查 Agent 升级计划', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/upgrades/result', operationId: 'submitAgentUpgradeResult', summary: '提交 Agent 升级结果', tags, responseSchema: schema },
  ];
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function requestId(request: HttpRequest): string {
  return request.context.requestId ?? 'req_missing';
}

function actorId(request: HttpRequest): string {
  return request.context.actorId ?? 'system';
}

function readQuery(request: HttpRequest, key: string, fallback?: string): string {
  const value = request.query[key];
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized && fallback !== undefined) return fallback;
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${key} 不能为空`, { key });
  return normalized;
}

function readOptionalCsv(request: HttpRequest, key: string): string[] | undefined {
  const value = request.query[key];
  const normalized = Array.isArray(value) ? value.join(',') : value;
  if (!normalized) return undefined;
  return normalized.split(',').map((item) => item.trim()).filter(Boolean);
}
