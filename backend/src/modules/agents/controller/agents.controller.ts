import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { AgentStatuses } from '../../../shared/enums/core.enums.js';
import { AgentsApplicationService } from '../application/agents.application-service.js';
import type {
  AckAgentTaskInput,
  AgentCapabilitySnapshotInput,
  AgentHeartbeatInput,
  CheckAgentUpgradeInput,
  CreateAgentCertificateSigningRequestInput,
  CreateAgentSessionInput,
  CreateEnrollmentTokenInput,
  CreateLinuxGoInstallSessionInput,
  CreateWindowsPowerShellInstallSessionInput,
  DisableAgentInput,
  EnqueueAgentTaskInput,
  PublishAgentVersionInput,
  RegisterAgentInput,
  RevokeAgentCertificateInput,
  RotateAgentCertificateInput,
  SignAgentCertificateInput,
  SubmitAgentTaskLogInput,
  SubmitAgentTaskLogsInput,
  SubmitAgentTaskResultInput,
  SubmitAgentUpgradeResultInput,
} from '../dto/agents.dto.js';
import type { AgentTaskEnvelope } from '../schema/agents.schema.js';

const tags = ['Agents'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class AgentsController {
  constructor(private readonly service = new AgentsApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/agents', '查询 Agent 列表', tags, (request) => this.listAgents(request));
    router.get('/api/v1/agents/detail', '查询 Agent 详情聚合', tags, (request) => this.getAgentDetail(request));
    router.get('/api/v1/agents/capabilities', '查询 Agent 能力快照', tags, (request) => this.getCapabilities(request));
    router.get('/api/v1/agents/certificates', '查询 Agent 证书列表', tags, (request) => this.listCertificates(request));
    router.get('/api/v1/agents/tasks', '查询 Agent 任务队列', tags, (request) => this.listTaskQueue(request));
    router.get('/api/v1/agents/tasks/log-cursor', '查询 Agent 日志 ack cursor', tags, (request) => this.getLogCursor(request));
    router.get('/api/v1/agents/upgrades/suggestion', '查询 Agent 升级建议', tags, (request) => this.getUpgradeSuggestion(request));
    router.post('/api/v1/agents/enrollment-tokens', '创建 Agent 注册令牌', tags, (request) => this.createEnrollmentToken(request));
    router.post('/api/v1/agents/install-sessions/windows-powershell', '创建 Windows PowerShell Agent 安装会话', tags, (request) => this.createWindowsPowerShellInstallSession(request));
    router.post('/api/v1/agents/install-sessions/linux-go', '创建 Linux Go Agent 安装会话', tags, (request) => this.createLinuxGoInstallSession(request));
    router.get('/api/v1/agents/install/windows/bootstrap.ps1', '获取 Windows PowerShell Agent bootstrap 脚本', tags, (request) => this.getWindowsPowerShellBootstrap(request));
    router.get('/api/v1/agents/install/windows/manifest', '获取 Windows PowerShell Agent 安装清单', tags, (request) => this.getWindowsPowerShellManifest(request));
    router.get('/api/v1/agents/install/linux/bootstrap.sh', '获取 Linux Go Agent bootstrap 脚本', tags, (request) => this.getLinuxGoBootstrap(request));
    router.get('/api/v1/agents/install/linux/manifest', '获取 Linux Go Agent 安装清单', tags, (request) => this.getLinuxGoManifest(request));
    router.get('/api/v1/agents/install/linux/bundle.tar.gz', '下载 Linux Go Agent 安装 bundle', tags, (request) => this.getLinuxBundle(request));
    router.post('/api/v1/agents/disable', '禁用 Agent', tags, (request) => this.disableAgent(request));
    router.post('/api/v1/agents/register', '注册 Agent', tags, (request) => this.registerAgent(request));
    router.post('/api/v1/agents/sessions', '创建 Agent mTLS 会话', tags, (request) => this.createSession(request));
    router.post('/api/v1/agents/certificate-requests', '创建 Agent CSR', tags, (request) => this.createCertificateSigningRequest(request));
    router.post('/api/v1/agents/certificates/sign', '签发 Agent 证书', tags, (request) => this.signCertificate(request));
    router.post('/api/v1/agents/certificates/rotate', '轮换 Agent 证书', tags, (request) => this.rotateCertificate(request));
    router.post('/api/v1/agents/certificates/revoke', '吊销 Agent 证书', tags, (request) => this.revokeCertificate(request));
    router.post('/api/v1/agents/heartbeat', 'Agent 心跳', tags, (request) => this.heartbeat(request));
    router.post('/api/v1/agents/capabilities', 'Agent 能力快照上报', tags, (request) => this.reportCapabilities(request));
    router.post('/api/v1/agents/tasks', '创建 Agent 任务', tags, (request) => this.enqueueTask(request));
    router.get('/api/v1/agents/tasks/pull', 'Agent 拉取任务', tags, (request) => this.pullTasks(request));
    router.post('/api/v1/agents/tasks/ack', 'Agent 确认任务', tags, (request) => this.ackTask(request));
    router.post('/api/v1/agents/tasks/logs', 'Agent 提交任务日志', tags, (request) => this.submitLog(request));
    router.post('/api/v1/agents/tasks/log-batches', 'Agent 批量提交任务日志并返回 ack cursor', tags, (request) => this.submitLogBatch(request));
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
    return {
      statusCode: 201,
      body: this.service.createEnrollmentToken(tenantId(request), { createdBy: actorId(request), ...body } as unknown as CreateEnrollmentTokenInput, requestId(request)),
    };
  }

  private createWindowsPowerShellInstallSession(request: HttpRequest) {
    const body = validateObject(request.body, {
      zone: { type: 'string' },
      serviceName: { type: 'string' },
      displayName: { type: 'string' },
      installRoot: { type: 'string' },
      configDir: { type: 'string' },
      dataDir: { type: 'string' },
      logDir: { type: 'string' },
      startAfterInstall: { type: 'boolean' },
    });
    return {
      statusCode: 201,
      body: this.service.createWindowsPowerShellInstallSession(
        tenantId(request),
        body as unknown as CreateWindowsPowerShellInstallSessionInput,
        requestId(request),
        inferBaseUrl(request),
      ),
    };
  }

  private createLinuxGoInstallSession(request: HttpRequest) {
    const body = validateObject(request.body, {
      zone: { type: 'string' },
      agentKey: { type: 'string' },
      serviceName: { type: 'string' },
      displayName: { type: 'string' },
      installRoot: { type: 'string' },
      configDir: { type: 'string' },
      dataDir: { type: 'string' },
      logDir: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: this.service.createLinuxGoInstallSession(
        tenantId(request),
        body as unknown as CreateLinuxGoInstallSessionInput,
        requestId(request),
        inferBaseUrl(request),
      ),
    };
  }

  private async getWindowsPowerShellBootstrap(request: HttpRequest) {
    const token = readQuery(request, 'token');
    const session = await this.service.consumeInstallSessionByToken(token, request.context.ip);
    const manifest = await this.service.buildWindowsPowerShellInstallManifest(session);
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
      body: renderWindowsPowerShellBootstrapScript(manifest),
    };
  }

  private async getWindowsPowerShellManifest(request: HttpRequest) {
    const token = readQuery(request, 'token');
    const session = await this.service.getInstallSessionByToken(token);
    return this.service.buildWindowsPowerShellInstallManifest(session);
  }

  private async getLinuxGoBootstrap(request: HttpRequest) {
    const token = readQuery(request, 'token');
    const session = await this.service.consumeInstallSessionByToken(token, request.context.ip);
    const manifest = this.service.buildLinuxGoInstallManifest(session, inferBaseUrl(request));
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/x-shellscript; charset=utf-8',
      },
      body: renderLinuxBootstrapScript(manifest),
    };
  }

  private async getLinuxGoManifest(request: HttpRequest) {
    const token = readQuery(request, 'token');
    const session = await this.service.consumeInstallSessionByToken(token, request.context.ip);
    return this.service.buildLinuxGoInstallManifest(session, inferBaseUrl(request));
  }

  private getLinuxBundle(_request: HttpRequest) {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename=\"gcac-linux-agent-bundle.tar.gz\"',
      },
      body: this.service.buildLinuxBundleTarGz(),
    };
  }

  private getAgentDetail(request: HttpRequest) {
    return this.service.getAgentDetail(tenantId(request), readQuery(request, 'agentId'));
  }

  private getCapabilities(request: HttpRequest) {
    return this.service.getCapabilityProjection(tenantId(request), readQuery(request, 'agentId'));
  }

  private listCertificates(request: HttpRequest) {
    return this.service.listCertificates(tenantId(request), readQuery(request, 'agentId'));
  }

  private listTaskQueue(request: HttpRequest) {
    const statuses = readOptionalCsv(request, 'status');
    return this.service.listTaskQueue(tenantId(request), readQuery(request, 'agentId'), statuses as AgentTaskEnvelope['status'][] | undefined);
  }

  private getUpgradeSuggestion(request: HttpRequest) {
    return this.service.getUpgradeSuggestion(tenantId(request), readQuery(request, 'agentId'));
  }

  private getLogCursor(request: HttpRequest) {
    return this.service.getLogCursor(tenantId(request), readQuery(request, 'agentId'), readQuery(request, 'taskId'));
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

  private createCertificateSigningRequest(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      csrPem: { type: 'string', required: true },
      requestedTtlDays: { type: 'number' },
    });
    return { statusCode: 201, body: this.service.createCertificateSigningRequest(tenantId(request), body as unknown as CreateAgentCertificateSigningRequestInput, actorId(request), requestId(request)) };
  }

  private signCertificate(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      csrId: { type: 'string', required: true },
      ttlDays: { type: 'number' },
      issuedBy: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.signCertificate(tenantId(request), { issuedBy: actorId(request), ...body } as unknown as SignAgentCertificateInput) };
  }

  private rotateCertificate(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      csrPem: { type: 'string', required: true },
      ttlDays: { type: 'number' },
      issuedBy: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.rotateCertificate(tenantId(request), { issuedBy: actorId(request), ...body } as unknown as RotateAgentCertificateInput, requestId(request)) };
  }

  private revokeCertificate(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      certificateId: { type: 'string', required: true },
      reason: { type: 'string' },
      revokedBy: { type: 'string' },
    });
    return this.service.revokeCertificate(tenantId(request), { revokedBy: actorId(request), ...body } as unknown as RevokeAgentCertificateInput);
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

  private submitLogBatch(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      taskId: { type: 'string', required: true },
      logs: { type: 'array', required: true },
    });
    return this.service.submitLogs(tenantId(request), body as unknown as SubmitAgentTaskLogsInput, requestId(request));
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
    { method: 'GET', path: '/api/v1/agents/certificates', operationId: 'listAgentCertificates', summary: '查询 Agent 证书列表', tags, responseSchema: { type: 'array', items: schema } },
    { method: 'GET', path: '/api/v1/agents/tasks', operationId: 'listAgentTaskQueue', summary: '查询 Agent 任务队列', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/tasks/log-cursor', operationId: 'getAgentTaskLogCursor', summary: '查询 Agent 日志 ack cursor', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/upgrades/suggestion', operationId: 'getAgentUpgradeSuggestion', summary: '查询 Agent 升级建议', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/enrollment-tokens', operationId: 'createAgentEnrollmentToken', summary: '创建 Agent 注册令牌', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/install-sessions/windows-powershell', operationId: 'createWindowsPowerShellAgentInstallSession', summary: '创建 Windows PowerShell Agent 安装会话', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/install/windows/bootstrap.ps1', operationId: 'getWindowsPowerShellAgentBootstrap', summary: '获取 Windows PowerShell Agent bootstrap 脚本', tags, responseSchema: { type: 'string' } },
    { method: 'GET', path: '/api/v1/agents/install/windows/manifest', operationId: 'getWindowsPowerShellAgentInstallManifest', summary: '获取 Windows PowerShell Agent 安装清单', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/disable', operationId: 'disableAgent', summary: '禁用 Agent', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/register', operationId: 'registerAgent', summary: '注册 Agent', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/sessions', operationId: 'createAgentMtlsSession', summary: '创建 Agent mTLS 会话', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/certificate-requests', operationId: 'createAgentCertificateSigningRequest', summary: '创建 Agent CSR', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/certificates/sign', operationId: 'signAgentCertificate', summary: '签发 Agent 证书', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/certificates/rotate', operationId: 'rotateAgentCertificate', summary: '轮换 Agent 证书', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/certificates/revoke', operationId: 'revokeAgentCertificate', summary: '吊销 Agent 证书', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/heartbeat', operationId: 'heartbeatAgent', summary: 'Agent 心跳', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/capabilities', operationId: 'reportAgentCapabilities', summary: 'Agent 能力快照上报', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/tasks', operationId: 'enqueueAgentTask', summary: '创建 Agent 任务', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/agents/tasks/pull', operationId: 'pullAgentTasks', summary: 'Agent 拉取任务', tags, responseSchema: { type: 'array', items: schema } },
    { method: 'POST', path: '/api/v1/agents/tasks/ack', operationId: 'ackAgentTask', summary: 'Agent 确认任务', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/tasks/logs', operationId: 'submitAgentTaskLog', summary: 'Agent 提交任务日志', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/tasks/log-batches', operationId: 'submitAgentTaskLogBatch', summary: 'Agent 批量提交任务日志并返回 ack cursor', tags, responseSchema: schema },
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

function inferBaseUrl(request: HttpRequest): string {
  const forwardedProto = Array.isArray(request.headers['x-forwarded-proto']) ? request.headers['x-forwarded-proto'][0] : request.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' && forwardedProto ? forwardedProto : 'http';
  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host;
  return `${proto}://${host ?? 'localhost'}`;
}

function renderWindowsPowerShellBootstrapScript(manifest: unknown): string {
  const manifestJson = JSON.stringify(manifest, null, 2);
  return [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8',
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '$manifest = @\'',
    manifestJson,
    '\'@ | ConvertFrom-Json',
    '$utf8Bom = New-Object System.Text.UTF8Encoding($true)',
    "$root = Join-Path $env:TEMP ('gcac-winps-agent-' + $manifest.sessionId)",
    'New-Item -ItemType Directory -Force -Path $root | Out-Null',
    'foreach ($artifact in $manifest.artifacts) {',
    '  $path = Join-Path $root $artifact.path',
    '  $dir = Split-Path -Parent $path',
    '  New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    '  [System.IO.File]::WriteAllText($path, [string]$artifact.content, $utf8Bom)',
    '}',
    "$configPath = Join-Path $root 'config\\agent.config.template.json'",
    '$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json',
    '$config.tenantId = [string]$manifest.tenantId',
    '$config.agentKey = [string]$manifest.agentKey',
    '$config.controlPlaneUrl = [string]$manifest.controlPlaneUrl',
    '$config.service.name = [string]$manifest.serviceName',
    '$config.service.displayName = [string]$manifest.displayName',
    "$config.paths.windows.configPath = [string](Join-Path $manifest.configDir 'agent.config.json')",
    '$config.paths.windows.dataDir = [string]$manifest.dataDir',
    '$config.paths.windows.logDir = [string]$manifest.logDir',
    "if ($null -eq $config.PSObject.Properties['zone']) { $config | Add-Member -NotePropertyName zone -NotePropertyValue ([string]$manifest.zone) } else { $config.zone = [string]$manifest.zone }",
    "if ($null -eq $config.PSObject.Properties['enrollmentToken']) { $config | Add-Member -NotePropertyName enrollmentToken -NotePropertyValue ([string]$manifest.enrollmentToken) } else { $config.enrollmentToken = [string]$manifest.enrollmentToken }",
    '[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), $utf8Bom)',
    'New-Item -ItemType Directory -Force -Path $manifest.dataDir | Out-Null',
    "$installScript = Join-Path $root 'install-service.ps1'",
    "$entryScript = Join-Path $root 'Start-GcacFullAgent.ps1'",
    "$selfCheckPath = Join-Path $manifest.logDir 'bootstrap-selfcheck.json'",
    "$runOncePath = Join-Path $manifest.logDir 'bootstrap-register.json'",
    '$params = @{ ServiceName = [string]$manifest.serviceName; DisplayName = [string]$manifest.displayName; InstallRoot = [string]$manifest.installRoot; ConfigDir = [string]$manifest.configDir; LogDir = [string]$manifest.logDir }',
    '& powershell -NoProfile -ExecutionPolicy Bypass -File $installScript @params',
    "& powershell -NoProfile -ExecutionPolicy Bypass -File $entryScript -SelfCheck -ConfigPath (Join-Path $manifest.configDir 'agent.config.json') -LogDir $manifest.logDir -OutputPath $selfCheckPath",
    "if ($LASTEXITCODE -ne 0) { throw 'Bootstrap self-check failed after service installation.' }",
    "& powershell -NoProfile -ExecutionPolicy Bypass -File $entryScript -RunOnce -ConfigPath (Join-Path $manifest.configDir 'agent.config.json') -LogDir $manifest.logDir -OutputPath $runOncePath",
    "if ($LASTEXITCODE -ne 0) { throw 'Bootstrap first registration run failed.' }",
    "$installMetadataPath = Join-Path $manifest.configDir 'service.install.json'",
    'if (Test-Path -LiteralPath $installMetadataPath) {',
    '  $installMetadata = Get-Content -LiteralPath $installMetadataPath -Raw | ConvertFrom-Json',
    '  $installMetadata.LastBootstrapSelfCheckPath = $selfCheckPath',
    '  $installMetadata.LastBootstrapRunOncePath = $runOncePath',
    '  [System.IO.File]::WriteAllText($installMetadataPath, ($installMetadata | ConvertTo-Json -Depth 10), $utf8Bom)',
    '}',
    "Write-Warning 'Automatic Start-Service is disabled for the current PowerShell skeleton service registration model. Start the wrapper-based service after service host integration is added.'",
    "Write-Host 'Bootstrap completed. Files staged at:' $root",
  ].join('\r\n')
}

function renderLinuxBootstrapScript(manifest: unknown): string {
  const manifestJson = JSON.stringify(manifest, null, 2);
  const installManifest = manifest as {
    bundleUrl?: string;
    serviceName?: string;
    displayName?: string;
    installRoot?: string;
    configDir?: string;
    dataDir?: string;
    logDir?: string;
    startAfterInstall?: boolean;
  };
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then',
    '  echo "请使用 root 或 sudo 执行安装脚本" >&2',
    '  exit 1',
    'fi',
    '',
    'WORKDIR="$(mktemp -d /tmp/gcac-linux-agent-XXXXXX)"',
    'cleanup() { rm -rf "$WORKDIR"; }',
    'trap cleanup EXIT',
    '',
    "cat <<'JSON' > \"$WORKDIR/manifest.json\"",
    manifestJson,
    'JSON',
    'MANIFEST_PATH="$WORKDIR/manifest.json" node <<\'NODE\'',
    'const fs = require("node:fs");',
    'const path = process.env.MANIFEST_PATH;',
    'const manifest = JSON.parse(fs.readFileSync(path, "utf8"));',
    'const config = {',
    '  schemaVersion: "full-agent.linux-go.config.v1",',
    '  tenantId: manifest.tenantId,',
    '  agentKey: manifest.agentKey,',
    '  enrollmentToken: manifest.enrollmentToken,',
    '  zone: manifest.zone,',
    '  controlPlaneUrl: manifest.controlPlaneUrl,',
    '  heartbeatIntervalSeconds: 30,',
    '  paths: {',
    '    linux: {',
    '      configPath: `${manifest.configDir}/agent.config.json`,',
    '      dataDir: manifest.dataDir,',
    '      logDir: manifest.logDir,',
    '    },',
    '  },',
    '  service: {',
    '    name: manifest.serviceName,',
    '    displayName: manifest.displayName,',
    '  },',
    '};',
    'fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\\n");',
    'NODE',
    '',
    `BUNDLE_URL=${toBashSingleQuoted(installManifest.bundleUrl ?? '')}`,
    `SERVICE_NAME=${toBashSingleQuoted(installManifest.serviceName ?? 'gcac-linux-agent')}`,
    `DISPLAY_NAME=${toBashSingleQuoted(installManifest.displayName ?? 'GCAC Linux Go Full Agent')}`,
    `INSTALL_ROOT=${toBashSingleQuoted(installManifest.installRoot ?? '/opt/gcac/linux-agent')}`,
    `CONFIG_DIR=${toBashSingleQuoted(installManifest.configDir ?? '/etc/gcac/linux-agent')}`,
    `DATA_DIR=${toBashSingleQuoted(installManifest.dataDir ?? '/var/lib/gcac/linux-agent')}`,
    `LOG_DIR=${toBashSingleQuoted(installManifest.logDir ?? '/var/log/gcac/linux-agent')}`,
    `START_AFTER_INSTALL=${toBashSingleQuoted(installManifest.startAfterInstall === true ? 'true' : 'false')}`,
    '',
    'curl -fsSL "$BUNDLE_URL" -o "$WORKDIR/bundle.tar.gz"',
    'tar -xzf "$WORKDIR/bundle.tar.gz" -C "$WORKDIR"',
    'install -d "$WORKDIR/config"',
    'install -m 0644 "$WORKDIR/manifest.json" "$WORKDIR/config/agent.config.template.json"',
    'chmod +x "$WORKDIR/linux/install-systemd.sh"',
    'SERVICE_NAME="$SERVICE_NAME" DISPLAY_NAME="$DISPLAY_NAME" INSTALL_ROOT="$INSTALL_ROOT" CONFIG_DIR="$CONFIG_DIR" DATA_DIR="$DATA_DIR" LOG_DIR="$LOG_DIR" START_AFTER_INSTALL="$START_AFTER_INSTALL" bash "$WORKDIR/linux/install-systemd.sh"',
  ].join('\n')
}

function toBashSingleQuoted(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}
