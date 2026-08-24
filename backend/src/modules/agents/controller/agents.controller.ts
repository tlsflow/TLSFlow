import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery, withAuthorization, type PageQuery } from '../../../common/pagination/pagination.js';
import { validateObject, type ObjectValidationSchema } from '../../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import { AgentStatuses } from '../../../shared/enums/core.enums.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { AgentsApplicationService, type AgentInstallMaterialRequest } from '../application/agents.application-service.js';
import type {
  AckAgentTaskInput,
  AgentCapabilitySnapshotInput,
  AgentHeartbeatInput,
  CheckAgentUpgradeInput,
  CreateAgentCertificateSigningRequestInput,
  CreateAgentSessionInput,
  CreateEnrollmentTokenInput,
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

export class AgentsController {
  constructor(private readonly service = new AgentsApplicationService(), private readonly security?: SecurityServices) {}

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
    router.post('/api/v1/agents/install-materials', '创建固定版本 Agent 安装材料', tags, (request) => this.createAgentInstallMaterials(request));
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

  private async listAgents(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['agentKey', 'status', 'registeredAt', 'updatedAt'],
      allowedFilterFields: ['agentKey', 'status'],
    });
    return this.service.listAgents(tenantId(request), await this.authorizedQuery(this.subjectFromRequest(request), 'agent', 'read', query));
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    return { id: actorId(request), type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private async authorizedQuery(subject: SecuritySubject, objectType: string, accessLevel: 'read' | 'edit' | 'control', query: PageQuery): Promise<PageQuery> {
    if (!this.security) return query;
    return withAuthorization(query, await this.security.objectPermissions.buildAuthorizedQuery(subject, objectType, accessLevel));
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

  private createAgentInstallMaterials(request: HttpRequest) {
    if (Object.keys(request.query).length > 0) {
      throw new AppError('VALIDATION_FAILED', '安装材料接口不接受查询参数');
    }
    const body = validateExactObject(request.body, {
      platform: { type: 'string', required: true, enum: ['windows_go', 'windows_compatibility', 'linux_go'] },
      role: { type: 'string', enum: ['full_agent', 'gateway'] },
      zone: { type: 'string' },
      agentKey: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: this.service.createAgentInstallMaterials(tenantId(request), body as unknown as AgentInstallMaterialRequest, requestId(request)),
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
    rejectRetiredDirectControl(request.body);
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
    rejectRetiredDirectControl(request.body);
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
      status: { type: 'string', enum: ['SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'] },
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
    {
      method: 'POST',
      path: '/api/v1/agents/install-materials',
      operationId: 'createAgentInstallMaterials',
      summary: '创建固定版本 Agent 安装材料',
      tags,
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['platform'],
        properties: {
          platform: { type: 'string', enum: ['windows_go', 'windows_compatibility', 'linux_go'] },
          role: { type: 'string', enum: ['full_agent', 'gateway'] },
          zone: { type: 'string' },
          agentKey: { type: 'string' },
        },
      },
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['installationId', 'expiresAt', 'enrollmentToken', 'materials', 'task'],
        properties: {
          installationId: { type: 'string' },
          expiresAt: { type: 'string' },
          enrollmentToken: { type: 'string' },
          materials: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['platform', 'arch', 'artifactRef', 'version', 'digest', 'signature', 'signatureAlgorithm', 'signingKeyId'],
              properties: {
                platform: { type: 'string', enum: ['windows_go', 'windows_compatibility', 'linux_go'] },
                arch: { type: 'string', enum: ['amd64', 'arm64'] },
                artifactRef: { type: 'string' },
                version: { type: 'string' },
                digest: { type: 'string' },
                signature: { type: 'string' },
                signatureAlgorithm: { type: 'string', enum: ['Ed25519'] },
                signingKeyId: { type: 'string' },
              },
            },
          },
          task: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'contractVersion', 'taskId', 'version', 'artifactRefs', 'expiresAt', 'digest', 'signature', 'signatureAlgorithm', 'signingKeyId', 'input'],
            properties: {
              type: { type: 'string', enum: ['agent.plan.execute'] },
              contractVersion: { type: 'string' },
              taskId: { type: 'string' },
              version: { type: 'string' },
              artifactRefs: { type: 'array', items: { type: 'string' } },
              expiresAt: { type: 'string' },
              digest: { type: 'string' },
              signature: { type: 'string' },
              signatureAlgorithm: { type: 'string', enum: ['Ed25519'] },
              signingKeyId: { type: 'string' },
              input: {
                type: 'object',
                additionalProperties: false,
                required: ['role', 'zone', 'agentKey', 'serviceName', 'displayName', 'installRoot', 'configDir', 'dataDir', 'logDir'],
                properties: {
                  role: { type: 'string', enum: ['full_agent', 'gateway'] },
                  zone: { type: 'string' },
                  agentKey: { type: 'string' },
                  serviceName: { type: 'string' },
                  displayName: { type: 'string' },
                  installRoot: { type: 'string' },
                  configDir: { type: 'string' },
                  dataDir: { type: 'string' },
                  logDir: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
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
  return requireTenantId(request);
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

function validateExactObject(input: unknown, schema: ObjectValidationSchema): Record<string, unknown> {
  const value = validateObject(input, schema);
  const allowedFields = new Set(Object.keys(schema));
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    throw new AppError('VALIDATION_FAILED', '请求体包含不支持的字段', { fields: unknownFields.sort() });
  }
  return value;
}

function rejectRetiredDirectControl(input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(value, 'directControl')) {
    throw new AppError('VALIDATION_FAILED', 'Agent Direct Control 协议已退役', {
      field: 'directControl',
      reason: 'AGENT_DIRECT_BYPASS_RETIRED',
      fallback: false,
    });
  }
  const runtimeHealth = value.runtimeHealth;
  if (runtimeHealth && typeof runtimeHealth === 'object' && !Array.isArray(runtimeHealth)) {
    rejectRetiredDirectControl(runtimeHealth);
  }
}
