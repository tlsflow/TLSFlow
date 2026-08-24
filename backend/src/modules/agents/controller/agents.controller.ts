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
  DeleteAgentInput,
  DisableAgentInput,
  EnableAgentInput,
  EnqueueAgentCapabilityRescanInput,
  EnqueueAgentTaskInput,
  PublishAgentVersionInput,
  RegisterAgentInput,
  RevokeAgentCertificateInput,
  RotateAgentCertificateInput,
  SignAgentCertificateInput,
  SubmitAgentTaskLogInput,
  SubmitAgentTaskLogsInput,
  SubmitAgentTaskResultInput,
  SubmitAgentRuntimeLogInput,
  SubmitAgentUpgradeResultInput,
} from '../dto/agents.dto.js';
import type { AgentTaskEnvelope } from '../schema/agents.schema.js';

const tags = ['Agents'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class AgentsController {
  constructor(private readonly service = new AgentsApplicationService()) {}

  register(router: Router): void {
    router.post('/api/v1/agents/enable', '启用 Agent', tags, (request) => this.enableAgent(request));
    router.post('/api/v1/agents/delete', '删除 Agent', tags, (request) => this.deleteAgent(request));
    router.get('/api/v1/agents', '查询 Agent 列表', tags, (request) => this.listAgents(request));
    router.get('/api/v1/agents/detail', '查询 Agent 详情聚合', tags, (request) => this.getAgentDetail(request));
    router.get('/api/v1/agents/capabilities', '查询 Agent 能力快照', tags, (request) => this.getCapabilities(request));
    router.get('/api/v1/agents/certificates', '查询 Agent 证书列表', tags, (request) => this.listCertificates(request));
    router.get('/api/v1/agents/tasks', '查询 Agent 任务队列', tags, (request) => this.listTaskQueue(request));
    router.get('/api/v1/agents/tasks/log-cursor', '查询 Agent 日志 ack cursor', tags, (request) => this.getLogCursor(request));
    router.get('/api/v1/agents/upgrades/suggestion', '查询 Agent 升级建议', tags, (request) => this.getUpgradeSuggestion(request));
    router.post('/api/v1/agents/:agentId/rescan', '创建 Agent 手动能力重扫任务', tags, (request) => this.enqueueCapabilityRescan(request));
    router.post('/api/v1/agents/enrollment-tokens', '创建 Agent 注册令牌', tags, (request) => this.createEnrollmentToken(request));
    router.post('/api/v1/agents/install-sessions/windows-powershell', '创建 Windows Go Agent 安装会话（兼容旧 PowerShell 入口）', tags, (request) => this.createWindowsPowerShellInstallSession(request));
    router.post('/api/v1/agents/install-sessions/linux-go', '创建 Linux Go Agent 安装会话', tags, (request) => this.createLinuxGoInstallSession(request));
    router.get('/agent-install.ps1', '获取 Windows Go Agent 短安装入口（兼容旧 PowerShell URL）', tags, (request) => this.getWindowsPowerShellBootstrap(request));
    router.get('/agent-install', '获取 Linux Go Agent 短安装入口', tags, (request) => this.getLinuxGoBootstrap(request));
    router.get('/api/v1/agents/install/windows/bootstrap.ps1', '获取 Windows Go Agent bootstrap 脚本（兼容旧 PowerShell URL）', tags, (request) => this.getWindowsPowerShellBootstrap(request));
    router.get('/api/v1/agents/install/windows/manifest', '获取 Windows Go Agent 安装清单（兼容旧 PowerShell URL）', tags, (request) => this.getWindowsPowerShellManifest(request));
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
    router.post('/api/v1/agents/runtime-logs', 'Agent 提交运行时日志', tags, (request) => this.submitRuntimeLog(request));
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
    const baseUrl = resolveInstallBaseUrl(request);
    const manifest = {
      ...(await this.service.buildWindowsPowerShellInstallManifest(session)),
      controlPlaneUrl: baseUrl,
    };
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
    const session = await this.service.getWindowsPowerShellInstallSessionByToken(tenantId(request), token);
    const baseUrl = resolveInstallBaseUrl(request);
    return {
      ...(await this.service.buildWindowsPowerShellInstallManifest(session)),
      controlPlaneUrl: baseUrl,
    };
  }

  private async getLinuxGoBootstrap(request: HttpRequest) {
    const token = readQuery(request, 'token');
    const session = await this.service.getInstallSessionByToken(token);
    const baseUrl = resolveInstallBaseUrl(request);
    const manifest = {
      ...this.service.buildLinuxGoInstallManifest(session),
      controlPlaneUrl: baseUrl,
      bundleUrl: `${baseUrl}/api/v1/agents/install/linux/bundle.tar.gz`,
    };
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
    const session = await this.service.getInstallSessionByToken(token);
    const baseUrl = resolveInstallBaseUrl(request);
    return {
      ...this.service.buildLinuxGoInstallManifest(session),
      controlPlaneUrl: baseUrl,
      bundleUrl: `${baseUrl}/api/v1/agents/install/linux/bundle.tar.gz`,
    };
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

  private enableAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
    });
    return this.service.enableAgent(tenantId(request), {
      agentId: String(body.agentId),
      actorId: actorId(request),
    } as EnableAgentInput, requestId(request));
  }

  private deleteAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
    });
    return this.service.deleteAgent(tenantId(request), {
      agentId: String(body.agentId),
      actorId: actorId(request),
    } as DeleteAgentInput);
  }

  private registerAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentKey: { type: 'string', required: true },
      machineId: { type: 'string' },
      hostname: { type: 'string', required: true },
      version: { type: 'string', required: true },
      osType: { type: 'string', required: true },
      arch: { type: 'string' },
      ipAddress: { type: 'string' },
      linuxDistribution: { type: 'string' },
      osVersion: { type: 'string' },
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
      directControl: { type: 'object' },
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
      runtimeHealth: { type: 'object' },
      adapters: { type: 'array' },
      capabilities: { type: 'array' },
      resourceLimits: { type: 'object' },
      currentLoad: { type: 'number' },
      maxConcurrentTasks: { type: 'number' },
      successRate: { type: 'number' },
      directControl: { type: 'object' },
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

  private enqueueCapabilityRescan(request: HttpRequest) {
    const agentId = readPathParam(request, 'agentId');
    return {
      statusCode: 201,
      body: this.service.enqueueCapabilityRescanTask(tenantId(request), {
        agentId,
        requestedBy: actorId(request),
      } as EnqueueAgentCapabilityRescanInput, requestId(request)),
    };
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

  private submitRuntimeLog(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      category: { type: 'string', required: true },
      level: { type: 'string' },
      summary: { type: 'string', required: true },
      detail: { type: 'object' },
      emittedAt: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.submitRuntimeLog(tenantId(request), body as unknown as SubmitAgentRuntimeLogInput, requestId(request)) };
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
    { method: 'POST', path: '/api/v1/agents/:agentId/rescan', operationId: 'enqueueAgentCapabilityRescanTask', summary: '创建 Agent 手动能力重扫任务', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/enrollment-tokens', operationId: 'createAgentEnrollmentToken', summary: '创建 Agent 注册令牌', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/agents/install-sessions/windows-powershell', operationId: 'createWindowsPowerShellAgentInstallSession', summary: '创建 Windows Go Agent 安装会话（兼容旧 PowerShell 入口）', tags, responseSchema: schema },
    { method: 'GET', path: '/agent-install.ps1', operationId: 'getWindowsPowerShellAgentShortInstall', summary: '获取 Windows Go Agent 短安装入口（兼容旧 PowerShell URL）', tags, responseSchema: { type: 'string' } },
    { method: 'GET', path: '/agent-install', operationId: 'getLinuxGoAgentShortInstall', summary: '获取 Linux Go Agent 短安装入口', tags, responseSchema: { type: 'string' } },
    { method: 'GET', path: '/api/v1/agents/install/windows/bootstrap.ps1', operationId: 'getWindowsPowerShellAgentBootstrap', summary: '获取 Windows Go Agent bootstrap 脚本（兼容旧 PowerShell URL）', tags, responseSchema: { type: 'string' } },
    { method: 'GET', path: '/api/v1/agents/install/windows/manifest', operationId: 'getWindowsPowerShellAgentInstallManifest', summary: '获取 Windows Go Agent 安装清单（兼容旧 PowerShell URL）', tags, responseSchema: schema },
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

function readPathParam(request: HttpRequest, key: string): string {
  const value = key === 'agentId'
    ? request.path.match(/^\/api\/v1\/agents\/([^/]+)\/rescan$/)?.[1]
    : undefined;
  if (!value) throw new AppError('VALIDATION_FAILED', `${key} 不能为空`, { key });
  return value;
}

function readOptionalCsv(request: HttpRequest, key: string): string[] | undefined {
  const value = request.query[key];
  const normalized = Array.isArray(value) ? value.join(',') : value;
  if (!normalized) return undefined;
  return normalized.split(',').map((item) => item.trim()).filter(Boolean);
}

function inferBaseUrl(request: HttpRequest): string {
  const configuredPublicBaseUrl = process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL?.trim();
  const forwardedHost = Array.isArray(request.headers['x-forwarded-host']) ? request.headers['x-forwarded-host'][0] : request.headers['x-forwarded-host'];
  const publicBaseUrl = Array.isArray(request.headers['x-public-base-url']) ? request.headers['x-public-base-url'][0] : request.headers['x-public-base-url'];
  const forwardedProto = Array.isArray(request.headers['x-forwarded-proto']) ? request.headers['x-forwarded-proto'][0] : request.headers['x-forwarded-proto'];
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  const referer = Array.isArray(request.headers.referer) ? request.headers.referer[0] : request.headers.referer;
  if (configuredPublicBaseUrl) {
    return configuredPublicBaseUrl.replace(/\/+$/u, '');
  }
  if (typeof publicBaseUrl === 'string' && publicBaseUrl.trim()) {
    return publicBaseUrl.trim().replace(/\/+$/u, '');
  }
  if (typeof origin === 'string' && origin.trim()) {
    return origin.trim().replace(/\/+$/u, '');
  }
  if (typeof referer === 'string' && referer.trim()) {
    try {
      const parsed = new URL(referer);
      return parsed.origin;
    } catch {
      // ignore invalid referer and continue fallback chain
    }
  }
  const proto = typeof forwardedProto === 'string' && forwardedProto ? forwardedProto : 'http';
  const host = typeof forwardedHost === 'string' && forwardedHost
    ? forwardedHost
    : (Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host);
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
    "$root = Join-Path $env:TEMP ('gcac-win-go-agent-' + $manifest.sessionId)",
    'New-Item -ItemType Directory -Force -Path $root | Out-Null',
    'foreach ($artifact in $manifest.artifacts) {',
    '  $path = Join-Path $root $artifact.path',
    '  $dir = Split-Path -Parent $path',
    '  New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    "  if ([string]$artifact.encoding -eq 'base64') {",
    '    [System.IO.File]::WriteAllBytes($path, [System.Convert]::FromBase64String([string]$artifact.content))',
    '  } else {',
    '    [System.IO.File]::WriteAllText($path, [string]$artifact.content, $utf8Bom)',
    '  }',
    '}',
    "$configPath = Join-Path $root 'config\\agent.config.template.json'",
    '$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json',
    '$config.tenantId = [string]$manifest.tenantId',
    '$config.agentKey = [string]$manifest.agentKey',
    '$config.controlPlaneUrl = [string]$manifest.controlPlaneUrl',
    '$config.service.name = [string]$manifest.serviceName',
    '$config.service.displayName = [string]$manifest.displayName',
    "$actualConfigPath = Join-Path $manifest.configDir 'agent.config.json'",
    "$envPath = Join-Path $manifest.configDir '.env'",
    '$config.paths.windows.configPath = [string]$actualConfigPath',
    '$config.paths.windows.dataDir = [string]$manifest.dataDir',
    '$config.paths.windows.logDir = [string]$manifest.logDir',
    "if ($null -eq $config.PSObject.Properties['directControlEnabled']) { $config | Add-Member -NotePropertyName directControlEnabled -NotePropertyValue $true } else { $config.directControlEnabled = [bool]$config.directControlEnabled }",
    "if ($null -eq $config.PSObject.Properties['directControlListenHost']) { $config | Add-Member -NotePropertyName directControlListenHost -NotePropertyValue '0.0.0.0' } elseif ([string]::IsNullOrWhiteSpace([string]$config.directControlListenHost)) { $config.directControlListenHost = '0.0.0.0' }",
    "if ($null -eq $config.PSObject.Properties['directControlListenPort']) { $config | Add-Member -NotePropertyName directControlListenPort -NotePropertyValue 18930 } elseif ([int]$config.directControlListenPort -le 0) { $config.directControlListenPort = 18930 }",
    "if ($null -eq $config.PSObject.Properties['directControlAdvertiseHost']) { $config | Add-Member -NotePropertyName directControlAdvertiseHost -NotePropertyValue '' } elseif ([string]::IsNullOrWhiteSpace([string]$config.directControlAdvertiseHost)) { $config.directControlAdvertiseHost = '' }",
    "if ($null -eq $config.PSObject.Properties['zone']) { $config | Add-Member -NotePropertyName zone -NotePropertyValue ([string]$manifest.zone) } else { $config.zone = [string]$manifest.zone }",
    "if ($null -eq $config.PSObject.Properties['enrollmentToken']) { $config | Add-Member -NotePropertyName enrollmentToken -NotePropertyValue ([string]$manifest.enrollmentToken) } else { $config.enrollmentToken = [string]$manifest.enrollmentToken }",
    'New-Item -ItemType Directory -Force -Path $manifest.configDir | Out-Null',
    '$envLines = @(',
    '  ("GCAC_TENANT_ID=" + [string]$manifest.tenantId),',
    '  ("GCAC_CONTROL_PLANE_URL=" + [string]$manifest.controlPlaneUrl),',
    '  ("GCAC_ENROLLMENT_TOKEN=" + [string]$manifest.enrollmentToken),',
    '  ("GCAC_ZONE=" + [string]$manifest.zone)',
    ')',
    '[System.IO.File]::WriteAllText($envPath, ($envLines -join "`r`n") + "`r`n", $utf8Bom)',
    '[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), $utf8Bom)',
    '[System.IO.File]::WriteAllText($actualConfigPath, ($config | ConvertTo-Json -Depth 10), $utf8Bom)',
    'New-Item -ItemType Directory -Force -Path $manifest.dataDir | Out-Null',
    "$installScript = Join-Path $root 'install-service.ps1'",
    "$binaryPath = Join-Path $manifest.installRoot 'gcac-agent.exe'",
    "if (-not (Test-Path -LiteralPath $binaryPath)) {",
    "  $binaryPath = Join-Path $root 'gcac-agent.exe'",
    "}",
    "if (-not (Test-Path -LiteralPath $binaryPath)) {",
    "  $binaryPath = Join-Path $root 'windows-go-full-agent.exe'",
    "}",
    "$selfCheckPath = Join-Path $manifest.logDir 'bootstrap-selfcheck.json'",
    "$runOncePath = Join-Path $manifest.logDir 'bootstrap-register.json'",
    '$params = @{ ServiceName = [string]$manifest.serviceName; DisplayName = [string]$manifest.displayName; InstallRoot = [string]$manifest.installRoot; ConfigDir = [string]$manifest.configDir; DataDir = [string]$manifest.dataDir; LogDir = [string]$manifest.logDir }',
    'if ([bool]$manifest.startAfterInstall) {',
    '  & powershell -NoProfile -ExecutionPolicy Bypass -File $installScript @params -StartAfterInstall',
    '} else {',
    '  & powershell -NoProfile -ExecutionPolicy Bypass -File $installScript @params',
    '}',
    "if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }",
    "$selfCheckOutput = & $binaryPath self-check --config=$actualConfigPath 2>&1 | Out-String",
    "$selfCheckExitCode = $LASTEXITCODE",
    "[System.IO.File]::WriteAllText($selfCheckPath, $selfCheckOutput, $utf8Bom)",
    'if ($selfCheckExitCode -ne 0) {',
    '  Write-Host "Bootstrap self-check output:"',
    '  Write-Host $selfCheckOutput',
    "  throw 'Bootstrap self-check failed after service installation.'",
    '}',
    "$registerOutput = & $binaryPath register-once --config=$actualConfigPath 2>&1 | Out-String",
    "$registerExitCode = $LASTEXITCODE",
    "[System.IO.File]::WriteAllText($runOncePath, $registerOutput, $utf8Bom)",
    'if ($registerExitCode -ne 0) {',
    '  Write-Warning "Bootstrap first registration run failed."',
    '  if (Test-Path -LiteralPath $runOncePath) {',
    '    Write-Host "Bootstrap register result:"',
    '    Get-Content -LiteralPath $runOncePath -Raw | Write-Host',
    '  }',
    '  $agentLogPath = Join-Path $manifest.logDir "agent.log"',
    '  if (Test-Path -LiteralPath $agentLogPath) {',
    '    Write-Host "Agent log:"',
    '    Get-Content -LiteralPath $agentLogPath -Raw | Write-Host',
    '  }',
    '  $runtimeLogPath = Join-Path $manifest.logDir "runtime.log"',
    '  if (Test-Path -LiteralPath $runtimeLogPath) {',
    '    Write-Host "Runtime log:"',
    '    Get-Content -LiteralPath $runtimeLogPath -Raw | Write-Host',
    '  }',
    "  throw 'Bootstrap first registration run failed.'",
    '}',
    "$installMetadataPath = Join-Path (Split-Path -Parent $manifest.configDir) 'service.install.json'",
    'if (Test-Path -LiteralPath $installMetadataPath) {',
    '  $installMetadata = Get-Content -LiteralPath $installMetadataPath -Raw | ConvertFrom-Json',
    "  if ($null -eq $installMetadata.PSObject.Properties['LastBootstrapSelfCheckPath']) {",
    '    $installMetadata | Add-Member -NotePropertyName LastBootstrapSelfCheckPath -NotePropertyValue $selfCheckPath',
    '  } else {',
    '    $installMetadata.LastBootstrapSelfCheckPath = $selfCheckPath',
    '  }',
    "  if ($null -eq $installMetadata.PSObject.Properties['LastBootstrapRunOncePath']) {",
    '    $installMetadata | Add-Member -NotePropertyName LastBootstrapRunOncePath -NotePropertyValue $runOncePath',
    '  } else {',
    '    $installMetadata.LastBootstrapRunOncePath = $runOncePath',
    '  }',
    '  [System.IO.File]::WriteAllText($installMetadataPath, ($installMetadata | ConvertTo-Json -Depth 10), $utf8Bom)',
    '}',
    'if ([bool]$manifest.startAfterInstall) {',
    '  try {',
    '    Start-Service -Name ([string]$manifest.serviceName)',
    '  } catch {',
    '    $stdoutLog = Join-Path $manifest.logDir "service-stdout.log"',
    '    $stderrLog = Join-Path $manifest.logDir "service-stderr.log"',
    '    Write-Warning ("Start-Service failed for: " + [string]$manifest.serviceName)',
    '    try { sc.exe qc ([string]$manifest.serviceName) | Write-Host } catch { }',
    '    if (Test-Path -LiteralPath $installMetadataPath) {',
    '      try {',
    '        $installMetadata = Get-Content -LiteralPath $installMetadataPath -Raw | ConvertFrom-Json',
    '        if ($null -ne $installMetadata -and -not [string]::IsNullOrWhiteSpace([string]$installMetadata.NssmExe)) {',
    '          & ([string]$installMetadata.NssmExe) get ([string]$manifest.serviceName) Application | Write-Host',
    '          & ([string]$installMetadata.NssmExe) get ([string]$manifest.serviceName) AppParameters | Write-Host',
    '          & ([string]$installMetadata.NssmExe) get ([string]$manifest.serviceName) AppDirectory | Write-Host',
    '        }',
    '      } catch { }',
    '    }',
    '    throw',
    '  }',
    '}',
    "Write-Host 'Bootstrap completed. Files staged at:' $root",
  ].join('\r\n')
}

function readOptionalQuery(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) return undefined;
  const trimmed = normalized.trim();
  return trimmed ? trimmed : undefined;
}

function resolveInstallBaseUrl(request: HttpRequest): string {
  const explicitBaseUrl = readOptionalQuery(request, 'baseUrl');
  if (explicitBaseUrl) {
    try {
      const parsed = new URL(explicitBaseUrl);
      return parsed.origin.replace(/\/+$/u, '');
    } catch {
      throw new AppError('VALIDATION_FAILED', 'baseUrl 格式不合法', { baseUrl: explicitBaseUrl });
    }
  }
  return inferBaseUrl(request);
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
    '  taskPollIntervalSeconds: 60,',
    '  healthCheckIntervalSeconds: 30,',
    '  offlineTimeoutSeconds: 180,',
    '  directControlEnabled: true,',
    '  directControlListenHost: "0.0.0.0",',
    '  directControlListenPort: 18931,',
    '  directControlAdvertiseHost: "",',
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
