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
import type { AckAgentTaskInput, AgentCapabilitySnapshotInput, AgentHeartbeatInput, CheckAgentUpgradeInput, CreateAgentCertificateSigningRequestInput, CreateAgentInstallSessionInput, CreateAgentSessionInput, CreateEnrollmentTokenInput, DeleteAgentInput, DisableAgentInput, DispatchAgentUpgradeInput, EnableAgentInput, EnqueueAgentTaskInput, PublishAgentVersionInput, RegisterAgentInput, RevokeAgentCertificateInput, RotateAgentCertificateInput, SignAgentCertificateInput, SubmitAgentTaskLogInput, SubmitAgentTaskLogsInput, SubmitAgentTaskResultInput, SubmitAgentRuntimeLogInput, SubmitAgentUpgradeResultInput } from '../dto/agents.dto.js';
import type { AgentTaskEnvelope } from '../schema/agents.schema.js';

const tags = ['Agents'];
const WINDOWS_COMPATIBILITY_PLATFORMS = new Set(['windows_compatibility_service']);

export class AgentsController {
  constructor(
    private readonly service = new AgentsApplicationService(),
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    // Agent 升级器不带控制面用户会话；Release ID 是不可猜测的租户绑定标识，
    // 服务端仍会在发送前重新校验产品线、状态、大小和 SHA-256。
    router.get('/agent-releases/:releaseId', '下载受控 Agent Release 制品', tags, (request) => this.downloadRelease(request));
    router.post('/api/v1/agents/enable', '启用 Agent', tags, (request) => this.enableAgent(request));
    router.post('/api/v1/agents/delete', '删除 Agent', tags, (request) => this.deleteAgent(request));
    router.get('/api/v1/agents', '查询 Agent 列表', tags, (request) => this.listAgents(request));
    router.get('/api/v1/agents/detail', '查询 Agent 详情聚合', tags, (request) => this.getAgentDetail(request));
    router.get('/api/v1/agents/capabilities', '查询 Agent 能力快照', tags, (request) => this.getCapabilities(request));
    router.get('/api/v1/agents/certificates', '查询 Agent 证书列表', tags, (request) => this.listCertificates(request));
    router.get('/api/v1/agents/tasks', '查询 Agent 任务队列', tags, (request) => this.listTaskQueue(request));
    router.get('/api/v1/agents/tasks/log-cursor', '查询 Agent 日志 ack cursor', tags, (request) => this.getLogCursor(request));
    router.get('/api/v1/agents/upgrades/suggestion', '查询 Agent 升级建议', tags, (request) => this.getUpgradeSuggestion(request));
    router.post('/api/v1/agents/:agentId/upgrades/check', '检查指定 Agent 升级计划', tags, (request) => this.checkAgentUpgrade(request));
    router.post('/api/v1/agents/:agentId/upgrades', '发送指定 Agent 升级事务', tags, (request) => this.dispatchAgentUpgrade(request));
    router.get('/api/v1/agents/:agentId/upgrades/:planId', '查询指定 Agent 升级事务状态', tags, (request) => this.getAgentUpgradeStatus(request));
    router.post('/api/v1/agents/:agentId/upgrades/:planId/retry', '重试指定 Agent 升级事务传输', tags, (request) => this.retryAgentUpgrade(request));
    router.post('/api/v1/agents/:agentId/rescan', '通过管理端点直接执行 Agent 手动能力重扫', tags, (request) => this.refreshDiscovery(request));
    router.post('/api/v1/agents/:agentId/management-probe', '立即探测 Agent TCP 管理端口', tags, (request) => this.probeManagementEndpoint(request));
    router.post('/api/v1/agents/enrollment-tokens', '创建 Agent 注册令牌', tags, (request) => this.createEnrollmentToken(request));
    router.post('/api/v1/agents/install-materials', '创建固定版本 Agent 安装材料', tags, (request) => this.createAgentInstallMaterials(request));
    router.post('/api/v1/agents/install-sessions', '创建 Agent 一键安装会话', tags, (request) => this.createAgentInstallSession(request));
    router.post('/api/v1/agents/install-sessions/windows-go', '创建 Windows Go Agent 一键安装会话', tags, (request) => this.createPlatformInstallSession(request, 'windows_go'));
    router.post('/api/v1/agents/install-sessions/windows-compatibility', '创建 Windows Compatibility Agent 一键安装会话', tags, (request) => this.createPlatformInstallSession(request, 'windows_compatibility'));
    router.post('/api/v1/agents/install-sessions/linux-go', '创建 Linux Go Agent 一键安装会话', tags, (request) => this.createPlatformInstallSession(request, 'linux_go'));
    router.get('/agent-install.ps1', '获取 Windows Agent 短安装入口', tags, (request) => this.getWindowsBootstrap(request));
    router.get('/agent-install', '获取 Linux Go Agent 短安装入口', tags, (request) => this.getLinuxGoBootstrap(request));
    router.get('/api/v1/agents/install/windows/bootstrap.ps1', '获取 Windows Agent bootstrap 脚本', tags, (request) => this.getWindowsBootstrap(request));
    router.get('/api/v1/agents/install/windows-compatibility/bootstrap.ps1', '获取 Windows Compatibility Agent bootstrap 脚本', tags, (request) => this.getWindowsBootstrap(request));
    router.get('/api/v1/agents/install/linux/bootstrap.sh', '获取 Linux Go Agent bootstrap 脚本', tags, (request) => this.getLinuxGoBootstrap(request));
    router.get('/api/v1/agents/install/linux/bundle.tar.gz', '下载 Linux Go Agent 安装包', tags, () => this.getLinuxBundle());
    router.get('/api/v1/agents/install/gateway/bundle.tar.gz', '下载独立 Gateway Agent 安装包', tags, () => this.getGatewayLinuxBundle());
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
    return {
      id: actorId(request),
      type: 'user',
      scope: {
        tenantId: request.context.tenantId,
        tenantScope: request.context.tenantScope,
      },
    };
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
      body: this.service.createEnrollmentToken(
        tenantId(request),
        {
          createdBy: actorId(request),
          ...body,
        } as unknown as CreateEnrollmentTokenInput,
        requestId(request),
      ),
    };
  }

  private createAgentInstallMaterials(request: HttpRequest) {
    if (Object.keys(request.query).length > 0) {
      throw new AppError('VALIDATION_FAILED', '安装材料接口不接受查询参数');
    }
    const body = validateExactObject(request.body, {
      platform: {
        type: 'string',
        required: true,
        enum: ['windows_go', 'windows_compatibility', 'linux_go'],
      },
      role: { type: 'string', enum: ['full_agent', 'gateway'] },
      zone: { type: 'string' },
      agentKey: { type: 'string' },
      relayAllowedTargets: { type: 'array' },
      relayAllowedPorts: { type: 'array' },
    });
    return {
      statusCode: 201,
      body: this.service.createAgentInstallMaterials(tenantId(request), body as unknown as AgentInstallMaterialRequest, requestId(request)),
    };
  }

  private createAgentInstallSession(request: HttpRequest) {
    if (Object.keys(request.query).length > 0) {
      throw new AppError('VALIDATION_FAILED', '安装会话接口不接受查询参数');
    }
    const body = validateAgentInstallSessionBody(request.body);
    return {
      statusCode: 201,
      body: this.service.createAgentInstallSession(tenantId(request), body, requestId(request), resolveInstallPublicBaseUrl(request)),
    };
  }

  private createPlatformInstallSession(request: HttpRequest, platform: CreateAgentInstallSessionInput['platform']) {
    if (Object.keys(request.query).length > 0) {
      throw new AppError('VALIDATION_FAILED', '安装会话接口不接受查询参数');
    }
    const body = validateAgentInstallSessionBody({
      ...(request.body as Record<string, unknown> | undefined),
      platform,
    });
    return {
      statusCode: 201,
      body: this.service.createAgentInstallSession(tenantId(request), body, requestId(request), resolveInstallPublicBaseUrl(request)),
    };
  }

  private async getWindowsBootstrap(request: HttpRequest) {
    const token = readQuery(request, 'token');
    const session = await this.service.getInstallSessionByToken(token);
    const manifest = await this.service.buildWindowsInstallManifest(session, resolveInstallPublicBaseUrl(request), token);
    await this.service.consumeInstallSessionByToken(token, request.context.ip);
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'referrer-policy': 'no-referrer',
      },
      body: renderWindowsBootstrapScript(manifest),
    };
  }

  private async getLinuxGoBootstrap(request: HttpRequest) {
    const token = readQuery(request, 'token');
    const session = await this.service.getInstallSessionByToken(token);
    const manifest = await this.service.buildLinuxGoInstallManifest(session, resolveInstallPublicBaseUrl(request));
    await this.service.consumeInstallSessionByToken(token, request.context.ip);
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/x-shellscript; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'referrer-policy': 'no-referrer',
      },
      body: renderLinuxBootstrapScript(manifest),
    };
  }

  private getLinuxBundle() {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename="gcac-linux-agent-bundle.tar.gz"',
      },
      body: this.service.buildLinuxBundleTarGz(),
    };
  }

  private getGatewayLinuxBundle() {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename="gcac-gateway-agent-bundle.tar.gz"',
      },
      body: this.service.buildGatewayLinuxBundleTarGz(),
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
    if (body.dryRun)
      return {
        dryRun: true,
        status: 'DISABLED',
        agentId: body.agentId,
        reason: body.reason,
        revokeCertificate: Boolean(body.revokeCertificate),
      };
    return this.service.disableAgent(
      tenantId(request),
      {
        agentId: String(body.agentId),
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        revokeCertificate: Boolean(body.revokeCertificate),
        actorId: actorId(request),
      },
      requestId(request),
    );
  }

  private enableAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
    });
    return this.service.enableAgent(
      tenantId(request),
      {
        agentId: String(body.agentId),
        actorId: actorId(request),
      } as EnableAgentInput,
      requestId(request),
    );
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

  private async registerAgent(request: HttpRequest) {
    rejectRetiredDirectControl(request.body);
    const body = validateObject(request.body, {
      agentKey: { type: 'string', required: true },
      machineId: { type: 'string' },
      hostname: { type: 'string', required: true },
      version: { type: 'string', required: true },
      osType: { type: 'string', required: true },
      arch: { type: 'string' },
      ipAddress: { type: 'string' },
      managementEndpoint: { type: 'string' },
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
    return {
      statusCode: 201,
      body: await this.service.register(tenantId(request), body as unknown as RegisterAgentInput, requestId(request)),
    };
  }

  private createSession(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      certificateFingerprint: { type: 'string', required: true },
    });
    return {
      statusCode: 201,
      body: this.service.createMtlsSession(tenantId(request), body as unknown as CreateAgentSessionInput, requestId(request)),
    };
  }

  private createCertificateSigningRequest(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      csrPem: { type: 'string', required: true },
      requestedTtlDays: { type: 'number' },
    });
    return {
      statusCode: 201,
      body: this.service.createCertificateSigningRequest(tenantId(request), body as unknown as CreateAgentCertificateSigningRequestInput, actorId(request), requestId(request)),
    };
  }

  private signCertificate(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      csrId: { type: 'string', required: true },
      ttlDays: { type: 'number' },
      issuedBy: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: this.service.signCertificate(tenantId(request), {
        issuedBy: actorId(request),
        ...body,
      } as unknown as SignAgentCertificateInput),
    };
  }

  private rotateCertificate(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      csrPem: { type: 'string', required: true },
      ttlDays: { type: 'number' },
      issuedBy: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: this.service.rotateCertificate(
        tenantId(request),
        {
          issuedBy: actorId(request),
          ...body,
        } as unknown as RotateAgentCertificateInput,
        requestId(request),
      ),
    };
  }

  private revokeCertificate(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      certificateId: { type: 'string', required: true },
      reason: { type: 'string' },
      revokedBy: { type: 'string' },
    });
    return this.service.revokeCertificate(tenantId(request), {
      revokedBy: actorId(request),
      ...body,
    } as unknown as RevokeAgentCertificateInput);
  }

  private heartbeat(request: HttpRequest) {
    rejectRetiredDirectControl(request.body);
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      status: { type: 'string', enum: AgentStatuses },
      version: { type: 'string', required: true },
      managementEndpoint: { type: 'string' },
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
    return {
      statusCode: 201,
      body: this.service.reportCapabilities(tenantId(request), body as unknown as AgentCapabilitySnapshotInput, requestId(request)),
    };
  }

  private enqueueTask(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      executionRunId: { type: 'string', required: true },
      executionStepId: { type: 'string', required: true },
      idempotencyKey: { type: 'string', required: true },
      payload: { type: 'object' },
    });
    return {
      statusCode: 201,
      body: this.service.enqueueTask(tenantId(request), body as unknown as EnqueueAgentTaskInput, requestId(request)),
    };
  }

  private refreshDiscovery(request: HttpRequest) {
    const agentId = readPathParam(request, 'agentId');
    return {
      statusCode: 200,
      body: this.service.refreshStandardDiscovery(tenantId(request), agentId, actorId(request), requestId(request)),
    };
  }

  private probeManagementEndpoint(request: HttpRequest) {
    const agentId = readPathParam(request, 'agentId', 'management-probe');
    const body = validateObject(request.body, {
      timeoutMs: { type: 'number' },
    });
    return {
      statusCode: 200,
      body: this.service.probeManagementEndpoint(tenantId(request), agentId, typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined),
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
    return {
      statusCode: 201,
      body: this.service.submitLog(tenantId(request), body as unknown as SubmitAgentTaskLogInput, requestId(request)),
    };
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
    return {
      statusCode: 201,
      body: this.service.submitRuntimeLog(tenantId(request), body as unknown as SubmitAgentRuntimeLogInput, requestId(request)),
    };
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
      status: {
        type: 'string',
        enum: ['SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'],
      },
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
      productLine: {
        type: 'string',
        enum: ['windows-go-full', 'linux-go-full', 'windows-compat-full', 'gateway', 'ca-node'],
      },
      signatureKeyId: { type: 'string' },
      artifactSignature: { type: 'string' },
      artifactSize: { type: 'number' },
      minCompatibilityLevel: { type: 'string' },
      downloadUrl: { type: 'string', required: true },
      checksumSha256: { type: 'string', required: true },
      signature: { type: 'string', required: true },
      rollbackVersion: { type: 'string' },
      rolloutPercent: { type: 'number' },
      createdBy: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: this.service.publishVersion(tenantId(request), {
        createdBy: actorId(request),
        ...body,
      } as unknown as PublishAgentVersionInput),
    };
  }

  private async downloadRelease(request: HttpRequest) {
    const prefix = '/agent-releases/';
    let releaseId: string;
    try {
      releaseId = decodeURIComponent(request.path.slice(prefix.length));
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Release ID 编码无效');
    }
    if (!releaseId || releaseId.includes('/')) throw new AppError('VALIDATION_FAILED', 'Release ID 无效');
    const artifact = await this.service.getReleaseArtifact(releaseId);
    const architecture = artifact.release.arch === 'arm64' ? 'arm64' : 'amd64';
    return {
      statusCode: 200,
      body: artifact.content,
      headers: {
        'content-type': 'application/vnd.microsoft.portable-executable',
        'content-length': String(artifact.content.length),
        'content-disposition': `attachment; filename="gcac-agent.windows-${architecture}.exe"`,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    };
  }

  private checkUpgrade(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
    });
    return this.service.checkUpgrade(tenantId(request), body as unknown as CheckAgentUpgradeInput);
  }

  private checkAgentUpgrade(request: HttpRequest) {
    const agentId = readUpgradeAgentId(request);
    const body = validateObject(request.body, {
      releaseId: { type: 'string' },
      targetVersion: { type: 'string' },
      idempotencyKey: { type: 'string' },
    });
    return this.service.checkUpgrade(tenantId(request), {
      agentId,
      ...body,
    } as CheckAgentUpgradeInput);
  }

  private dispatchAgentUpgrade(request: HttpRequest) {
    const agentId = readUpgradeAgentId(request);
    const body = validateObject(request.body, {
      planId: { type: 'string', required: true },
      approvalRef: { type: 'string' },
      policyRef: { type: 'string' },
      retryReason: { type: 'string' },
    });
    return this.service.dispatchUpgrade(tenantId(request), { agentId, ...body } as unknown as DispatchAgentUpgradeInput, actorId(request), requestId(request));
  }

  private getAgentUpgradeStatus(request: HttpRequest) {
    const { agentId, planId } = readUpgradeAgentAndPlan(request);
    return this.service.getUpgradeStatus(tenantId(request), agentId, planId);
  }

  private retryAgentUpgrade(request: HttpRequest) {
    const { agentId, planId } = readUpgradeAgentAndPlan(request);
    const body = validateObject(request.body, {
      retryReason: { type: 'string' },
    });
    return this.service.dispatchUpgrade(
      tenantId(request),
      {
        agentId,
        planId,
        retryReason: typeof body.retryReason === 'string' ? body.retryReason : undefined,
      },
      actorId(request),
      requestId(request),
    );
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
    {
      method: 'GET',
      path: '/api/v1/agents',
      operationId: 'listAgents',
      summary: '查询 Agent 列表',
      tags,
      responseSchema: { type: 'object', additionalProperties: true },
    },
    {
      method: 'GET',
      path: '/api/v1/agents/detail',
      operationId: 'getAgentDetail',
      summary: '查询 Agent 详情聚合',
      tags,
      responseSchema: schema,
    },
    {
      method: 'GET',
      path: '/api/v1/agents/capabilities',
      operationId: 'getAgentCapabilities',
      summary: '查询 Agent 能力快照',
      tags,
      responseSchema: schema,
    },
    {
      method: 'GET',
      path: '/api/v1/agents/certificates',
      operationId: 'listAgentCertificates',
      summary: '查询 Agent 证书列表',
      tags,
      responseSchema: { type: 'array', items: schema },
    },
    {
      method: 'GET',
      path: '/api/v1/agents/tasks',
      operationId: 'listAgentTaskQueue',
      summary: '查询 Agent 任务队列',
      tags,
      responseSchema: schema,
    },
    {
      method: 'GET',
      path: '/api/v1/agents/tasks/log-cursor',
      operationId: 'getAgentTaskLogCursor',
      summary: '查询 Agent 日志 ack cursor',
      tags,
      responseSchema: schema,
    },
    {
      method: 'GET',
      path: '/api/v1/agents/upgrades/suggestion',
      operationId: 'getAgentUpgradeSuggestion',
      summary: '查询 Agent 升级建议',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/:agentId/upgrades/check',
      operationId: 'checkAgentUpgradePlan',
      summary: '检查指定 Agent 升级计划',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/:agentId/upgrades',
      operationId: 'dispatchAgentUpgrade',
      summary: '发送指定 Agent 升级事务',
      tags,
      responseSchema: schema,
    },
    {
      method: 'GET',
      path: '/api/v1/agents/:agentId/upgrades/:planId',
      operationId: 'getAgentUpgradeStatus',
      summary: '查询指定 Agent 升级事务状态',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/:agentId/upgrades/:planId/retry',
      operationId: 'retryAgentUpgrade',
      summary: '重试指定 Agent 升级事务传输',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/:agentId/rescan',
      operationId: 'refreshAgentDiscovery',
      summary: '通过管理端点直接执行 Agent 手动能力重扫',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/:agentId/management-probe',
      operationId: 'probeAgentManagementEndpoint',
      summary: '立即探测 Agent TCP 管理端口',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/enrollment-tokens',
      operationId: 'createAgentEnrollmentToken',
      summary: '创建 Agent 注册令牌',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/install-sessions',
      operationId: 'createAgentInstallSession',
      summary: '创建 Agent 一键安装会话',
      tags,
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['platform'],
        properties: {
          platform: {
            type: 'string',
            enum: ['windows_go', 'windows_compatibility', 'linux_go'],
          },
          role: { type: 'string', enum: ['full_agent', 'gateway'] },
          zone: { type: 'string' },
          agentKey: { type: 'string' },
          relayAllowedTargets: { type: 'array', items: { type: 'string' } },
          relayAllowedPorts: { type: 'array', items: { type: 'number' } },
          serviceName: { type: 'string' },
          displayName: { type: 'string' },
          installRoot: { type: 'string' },
          configDir: { type: 'string' },
          dataDir: { type: 'string' },
          logDir: { type: 'string' },
          startAfterInstall: { type: 'boolean' },
        },
      },
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['sessionId', 'platform', 'expiresAt', 'bootstrapUrl', 'installCommand'],
        properties: {
          sessionId: { type: 'string' },
          platform: {
            type: 'string',
            enum: ['windows_go_service', 'windows_compatibility_service', 'linux_go_systemd'],
          },
          expiresAt: { type: 'string' },
          bootstrapUrl: { type: 'string' },
          installCommand: { type: 'string' },
          bootstrapTokenPreview: { type: 'string' },
          serviceName: { type: 'string' },
          displayName: { type: 'string' },
          installRoot: { type: 'string' },
          configDir: { type: 'string' },
          dataDir: { type: 'string' },
          logDir: { type: 'string' },
          agentKey: { type: 'string' },
          zone: { type: 'string' },
          role: { type: 'string', enum: ['full_agent', 'gateway'] },
          relayAllowedTargets: { type: 'array', items: { type: 'string' } },
          relayAllowedPorts: { type: 'array', items: { type: 'number' } },
          bundleUrl: { type: 'string' },
        },
      },
    },
    {
      method: 'POST',
      path: '/api/v1/agents/install-sessions/windows-go',
      operationId: 'createWindowsGoInstallSession',
      summary: '创建 Windows Go Agent 一键安装会话',
      tags,
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['full_agent'] },
          zone: { type: 'string' },
          agentKey: { type: 'string' },
          serviceName: { type: 'string' },
          displayName: { type: 'string' },
          installRoot: { type: 'string' },
          configDir: { type: 'string' },
          dataDir: { type: 'string' },
          logDir: { type: 'string' },
          startAfterInstall: { type: 'boolean' },
        },
      },
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/install-sessions/windows-compatibility',
      operationId: 'createWindowsCompatibilityInstallSession',
      summary: '创建 Windows Compatibility Agent 一键安装会话',
      tags,
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['full_agent'] },
          zone: { type: 'string' },
          agentKey: { type: 'string' },
          serviceName: { type: 'string' },
          displayName: { type: 'string' },
          installRoot: { type: 'string' },
          configDir: { type: 'string' },
          dataDir: { type: 'string' },
          logDir: { type: 'string' },
          startAfterInstall: { type: 'boolean' },
        },
      },
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/install-sessions/linux-go',
      operationId: 'createLinuxGoInstallSession',
      summary: '创建 Linux Go Agent 一键安装会话',
      tags,
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['full_agent', 'gateway'] },
          zone: { type: 'string' },
          agentKey: { type: 'string' },
          relayAllowedTargets: { type: 'array', items: { type: 'string' } },
          relayAllowedPorts: { type: 'array', items: { type: 'number' } },
          serviceName: { type: 'string' },
          displayName: { type: 'string' },
          installRoot: { type: 'string' },
          configDir: { type: 'string' },
          dataDir: { type: 'string' },
          logDir: { type: 'string' },
          startAfterInstall: { type: 'boolean' },
        },
      },
      responseSchema: schema,
    },
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
          platform: {
            type: 'string',
            enum: ['windows_go', 'windows_compatibility', 'linux_go'],
          },
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
                platform: {
                  type: 'string',
                  enum: ['windows_go', 'windows_compatibility', 'linux_go'],
                },
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
                  relayAllowedTargets: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  relayAllowedPorts: {
                    type: 'array',
                    items: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      method: 'POST',
      path: '/api/v1/agents/disable',
      operationId: 'disableAgent',
      summary: '禁用 Agent',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/register',
      operationId: 'registerAgent',
      summary: '注册 Agent',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/sessions',
      operationId: 'createAgentMtlsSession',
      summary: '创建 Agent mTLS 会话',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/certificate-requests',
      operationId: 'createAgentCertificateSigningRequest',
      summary: '创建 Agent CSR',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/certificates/sign',
      operationId: 'signAgentCertificate',
      summary: '签发 Agent 证书',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/certificates/rotate',
      operationId: 'rotateAgentCertificate',
      summary: '轮换 Agent 证书',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/certificates/revoke',
      operationId: 'revokeAgentCertificate',
      summary: '吊销 Agent 证书',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/heartbeat',
      operationId: 'heartbeatAgent',
      summary: 'Agent 心跳',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/capabilities',
      operationId: 'reportAgentCapabilities',
      summary: 'Agent 能力快照上报',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/tasks',
      operationId: 'enqueueAgentTask',
      summary: '创建 Agent 任务',
      tags,
      responseSchema: schema,
    },
    {
      method: 'GET',
      path: '/api/v1/agents/tasks/pull',
      operationId: 'pullAgentTasks',
      summary: 'Agent 拉取任务',
      tags,
      responseSchema: { type: 'array', items: schema },
    },
    {
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      operationId: 'ackAgentTask',
      summary: 'Agent 确认任务',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      operationId: 'submitAgentTaskLog',
      summary: 'Agent 提交任务日志',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/tasks/log-batches',
      operationId: 'submitAgentTaskLogBatch',
      summary: 'Agent 批量提交任务日志并返回 ack cursor',
      tags,
      responseSchema: schema,
    },
    {
      method: 'GET',
      path: '/api/v1/agents/tasks/logs',
      operationId: 'listAgentTaskLogs',
      summary: '查询 Agent 任务日志',
      tags,
      responseSchema: { type: 'array', items: schema },
    },
    {
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      operationId: 'submitAgentTaskResult',
      summary: 'Agent 提交任务结果',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/versions',
      operationId: 'publishAgentVersion',
      summary: '发布 Agent 版本',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/upgrades/check',
      operationId: 'checkAgentUpgrade',
      summary: '检查 Agent 升级计划',
      tags,
      responseSchema: schema,
    },
    {
      method: 'POST',
      path: '/api/v1/agents/upgrades/result',
      operationId: 'submitAgentUpgradeResult',
      summary: '提交 Agent 升级结果',
      tags,
      responseSchema: schema,
    },
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

function readPathParam(request: HttpRequest, key: string, suffix = 'rescan'): string {
  const value = key === 'agentId' ? request.path.match(new RegExp(`^/api/v1/agents/([^/]+)/${suffix}$`))?.[1] : undefined;
  if (!value) throw new AppError('VALIDATION_FAILED', `${key} 不能为空`, { key });
  return value;
}

function readUpgradeAgentId(request: HttpRequest): string {
  const value = request.path.match(/^\/api\/v1\/agents\/([^/]+)\/upgrades\/check$/u)?.[1] ?? request.path.match(/^\/api\/v1\/agents\/([^/]+)\/upgrades$/u)?.[1];
  if (!value)
    throw new AppError('VALIDATION_FAILED', 'agentId 不能为空', {
      key: 'agentId',
    });
  return value;
}

function readUpgradeAgentAndPlan(request: HttpRequest): {
  agentId: string;
  planId: string;
} {
  const match = request.path.match(/^\/api\/v1\/agents\/([^/]+)\/upgrades\/([^/]+)(?:\/retry)?$/u);
  if (!match?.[1] || !match[2])
    throw new AppError('VALIDATION_FAILED', '升级计划路径参数不能为空', {
      key: 'planId',
    });
  return { agentId: match[1], planId: match[2] };
}

function readOptionalCsv(request: HttpRequest, key: string): string[] | undefined {
  const value = request.query[key];
  const normalized = Array.isArray(value) ? value.join(',') : value;
  if (!normalized) return undefined;
  return normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateExactObject(input: unknown, schema: ObjectValidationSchema): Record<string, unknown> {
  const value = validateObject(input, schema);
  const allowedFields = new Set(Object.keys(schema));
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    throw new AppError('VALIDATION_FAILED', '请求体包含不支持的字段', {
      fields: unknownFields.sort(),
    });
  }
  return value;
}

function validateAgentInstallSessionBody(input: unknown): CreateAgentInstallSessionInput {
  const body = validateExactObject(input, {
    platform: {
      type: 'string',
      required: true,
      enum: ['windows_go', 'windows_compatibility', 'linux_go'],
    },
    role: { type: 'string', enum: ['full_agent', 'gateway'] },
    zone: { type: 'string' },
    agentKey: { type: 'string' },
    serviceName: { type: 'string' },
    displayName: { type: 'string' },
    installRoot: { type: 'string' },
    configDir: { type: 'string' },
    dataDir: { type: 'string' },
    logDir: { type: 'string' },
    startAfterInstall: { type: 'boolean' },
    relayAllowedTargets: { type: 'array' },
    relayAllowedPorts: { type: 'array' },
  });
  return body as unknown as CreateAgentInstallSessionInput;
}

function resolveInstallPublicBaseUrl(request: HttpRequest): string {
  const candidates = [process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL, singleHeader(request, 'x-public-base-url'), singleHeader(request, 'origin'), originFromReferer(singleHeader(request, 'referer')), inferredRequestOrigin(request)];
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return 'http://localhost';
}

function singleHeader(request: HttpRequest, key: string): string | undefined {
  const value = request.headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function originFromReferer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function inferredRequestOrigin(request: HttpRequest): string | undefined {
  const forwardedProto = singleHeader(request, 'x-forwarded-proto');
  const proto = forwardedProto?.split(',')[0]?.trim() || 'http';
  const forwardedHost = singleHeader(request, 'x-forwarded-host');
  const host = forwardedHost?.split(',')[0]?.trim() || singleHeader(request, 'host');
  return host ? `${proto}://${host}` : undefined;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin.replace(/\/+$/u, '');
  } catch {
    return undefined;
  }
}

function renderWindowsBootstrapScript(manifest: unknown): string {
  const platform = manifest && typeof manifest === 'object' ? (manifest as { platform?: unknown }).platform : undefined;
  return WINDOWS_COMPATIBILITY_PLATFORMS.has(String(platform)) ? renderWindowsCompatibilityBootstrapScript(manifest) : renderWindowsGoBootstrapScript(manifest);
}

function renderWindowsGoBootstrapScript(manifest: unknown): string {
  const manifestJson = JSON.stringify(manifest, null, 2);
  return [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8',
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$manifest = @'",
    manifestJson,
    "'@ | ConvertFrom-Json",
    '$utf8Bom = New-Object System.Text.UTF8Encoding($true)',
    "$root = Join-Path $env:TEMP ('gcac-windows-go-agent-' + $manifest.sessionId)",
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
    "$metadataPath = Join-Path (Split-Path -Parent ([string]$manifest.configDir)) 'service.install.json'",
    'function Wait-GoAgentProcessReleased {',
    '  param([string]$BinaryPath)',
    '  $expectedPath = $BinaryPath.ToLowerInvariant()',
    '  $deadline = [DateTime]::UtcNow.AddSeconds(30)',
    '  do {',
    '    $matching = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {',
    '      $path = [string]$_.ExecutablePath',
    '      -not [string]::IsNullOrWhiteSpace($path) -and $path.ToLowerInvariant() -eq $expectedPath',
    '    }',
    '    if ($null -eq $matching) { return }',
    '    Start-Sleep -Milliseconds 250',
    '  } while ([DateTime]::UtcNow -lt $deadline)',
    '  $matching | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    '  Start-Sleep -Seconds 1',
    '  $remaining = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {',
    '    $path = [string]$_.ExecutablePath',
    '    -not [string]::IsNullOrWhiteSpace($path) -and $path.ToLowerInvariant() -eq $expectedPath',
    '  }',
    '  if ($null -ne $remaining) { throw "Existing Go Agent process did not exit: $BinaryPath" }',
    '}',
    'function Remove-GoAgentService {',
    '  param([string]$Name, [string]$BinaryPath)',
    '  $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue',
    '  if ($null -eq $existing) { return }',
    '  if ($existing.Status -ne "Stopped") {',
    '    Stop-Service -Name $Name -Force -ErrorAction Stop',
    '    $existing.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))',
    '  }',
    '  $existing.Close()',
    '  & sc.exe delete $Name | Out-Null',
    '  if ($LASTEXITCODE -ne 0) { throw "Go Agent service deletion failed: $Name" }',
    '  $deadline = [DateTime]::UtcNow.AddSeconds(30)',
    '  do {',
    '    $remaining = Get-Service -Name $Name -ErrorAction SilentlyContinue',
    '    if ($null -eq $remaining) { break }',
    '    $remaining.Close()',
    '    Start-Sleep -Milliseconds 250',
    '  } while ([DateTime]::UtcNow -lt $deadline)',
    '  if ($null -ne (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { throw "Go Agent service deletion timed out: $Name" }',
    '  Wait-GoAgentProcessReleased -BinaryPath $BinaryPath',
    '}',
    '$isGateway = ([string]$manifest.role -eq "gateway")',
    '$binaryName = if ($isGateway) { "gcac-gateway-agent.exe" } else { "gcac-agent.exe" }',
    'if (-not $isGateway) {',
    '  $pluginSource = Join-Path $root "plugins/windows-runtime-discovery.exe"',
    '  if (-not (Test-Path -LiteralPath $pluginSource)) { throw "Windows Agent-side discovery plugin is missing from the bootstrap bundle." }',
    '}',
    '$agentTarget = Join-Path $manifest.installRoot $binaryName',
    '$updaterSource = Join-Path $root "gcac-agent-updater.exe"',
    '$updaterTarget = Join-Path $manifest.installRoot "gcac-agent-updater.exe"',
    'if (-not $isGateway -and -not (Test-Path -LiteralPath $updaterSource)) { throw "Windows Go Agent updater is missing from the bootstrap bundle." }',
    '$serviceNames = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)',
    '[void]$serviceNames.Add([string]$manifest.serviceName)',
    'if (Test-Path -LiteralPath $metadataPath) {',
    '  try {',
    '    $previousMetadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json',
    '    $previousServiceName = [string]$previousMetadata.ServiceName',
    '    if ([string]::IsNullOrWhiteSpace($previousServiceName)) { throw "ServiceName is empty" }',
    '    [void]$serviceNames.Add($previousServiceName)',
    '  } catch {',
    '    throw "Existing Go Agent installation metadata is invalid; refusing to remove an unknown service: $($_.Exception.Message)"',
    '  }',
    '}',
    '$escapedAgentPath = [regex]::Escape($agentTarget)',
    '$servicesUsingAgentBinary = Get-CimInstance -ClassName Win32_Service -ErrorAction SilentlyContinue | Where-Object {',
    '  $path = [string]$_.PathName',
    '  $path -match ("(?i)^\\s*(?:" + [char]34 + $escapedAgentPath + [char]34 + "|" + $escapedAgentPath + ")(?:\\s|$)")',
    '}',
    'foreach ($serviceUsingAgentBinary in $servicesUsingAgentBinary) { [void]$serviceNames.Add([string]$serviceUsingAgentBinary.Name) }',
    'foreach ($serviceName in $serviceNames) { Remove-GoAgentService -Name $serviceName -BinaryPath $agentTarget }',
    'function Remove-GoAgentLegacyFirewallRules {',
    '  $getRule = Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue',
    '  $removeRule = Get-Command Remove-NetFirewallRule -ErrorAction SilentlyContinue',
    '  if ($null -eq $getRule -or $null -eq $removeRule) { return }',
    '  Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { [string]$_.DisplayName -like "GCAC Agent Direct Control (*)" } | Remove-NetFirewallRule -ErrorAction SilentlyContinue',
    '}',
    'Remove-GoAgentLegacyFirewallRules',
    'function Configure-GoAgentFirewall {',
    '  param([string]$ProgramPath, [int]$Port)',
    '  $ruleName = "GCAC Go Full Agent Management TCP $Port"',
    '  if (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) {',
    '    Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {',
    '      [string]$_.DisplayName -eq $ruleName -or [string]$_.DisplayName -like "GCAC Agent Direct Control (*)"',
    '    } | Remove-NetFirewallRule -ErrorAction SilentlyContinue',
    '  } else {',
    '    $deleteOutput = (& netsh.exe advfirewall firewall delete rule name="GCAC Go Full Agent Management TCP $Port" 2>&1 | Out-String)',
    '    if ($LASTEXITCODE -ne 0 -and $deleteOutput -notmatch "(?i)no rules match|没有规则匹配|找不到规则") { throw "Go Agent firewall rule cleanup failed: $ruleName`n$deleteOutput" }',
    '  }',
    '  & netsh.exe advfirewall firewall add rule name=$ruleName dir=in action=allow protocol=TCP localport=$Port program=$ProgramPath profile=any | Out-Null',
    '  if ($LASTEXITCODE -ne 0) { throw "Go Agent firewall rule creation failed: $ruleName" }',
    '}',
    'if ($isGateway) {',
    '  Configure-GoAgentFirewall -ProgramPath $agentTarget -Port 18935',
    '  Configure-GoAgentFirewall -ProgramPath $agentTarget -Port 18934',
    '} else {',
    '  Configure-GoAgentFirewall -ProgramPath $agentTarget -Port 18930',
    '}',
    '$agentSource = Join-Path $root $binaryName',
    'New-Item -ItemType Directory -Force -Path $manifest.installRoot, $manifest.configDir | Out-Null',
    'Copy-Item -LiteralPath $agentSource -Destination $agentTarget -Force',
    "$configPath = Join-Path $manifest.configDir 'agent.config.json'",
    "$policyDir = Join-Path ([string]$manifest.dataDir) 'policy'",
    '$authorizationTrustKeySet = if ($null -eq $manifest.authorizationTrustKeySet) { @{} } else { $manifest.authorizationTrustKeySet }',
    '$upgradeTrustKeySet = if ($null -eq $manifest.upgradeTrustKeySet) { @{} } else { $manifest.upgradeTrustKeySet }',
    '$releaseTrustKeySet = if ($null -eq $manifest.releaseTrustKeySet) { @{} } else { $manifest.releaseTrustKeySet }',
    '$config = [ordered]@{',
    '  schemaVersion = if ($isGateway) { "gcac.gateway-agent.v1" } else { "full-agent.go.windows.config.v1" }',
    '  tenantId = [string]$manifest.tenantId',
    '  agentKey = [string]$manifest.agentKey',
    '  enrollmentToken = [string]$manifest.enrollmentToken',
    '  zone = [string]$manifest.zone',
    '  controlPlaneUrl = [string]$manifest.controlPlaneUrl',
    '  heartbeatIntervalSeconds = 10',
    '  taskPollIntervalSeconds = 60',
    '  healthCheckIntervalSeconds = 30',
    '  offlineTimeoutSeconds = 180',
    '  managementListenAddress = "0.0.0.0"',
    '  managementPort = if ($isGateway) { 18935 } else { 18930 }',
    '  authorizationMaterialPath = [string](Join-Path $policyDir "agent-trust-material.json")',
    '  authorizationTrustKeySet = $authorizationTrustKeySet',
    '  upgradeTrustKeySet = $upgradeTrustKeySet',
    '  releaseTrustKeySet = $releaseTrustKeySet',
    '  receiptKeyId = ""',
    '  receiptSigningKeyPath = [string](Join-Path $policyDir "agent-receipt-signing-key.bin")',
    '  receiptKeySetPath = [string](Join-Path $policyDir "agent-receipt-keyset.json")',
    '  paths = @{ windows = @{ configPath = [string]$configPath; dataDir = [string]$manifest.dataDir; logDir = [string]$manifest.logDir } }',
    '  service = @{ name = [string]$manifest.serviceName; displayName = [string]$manifest.displayName }',
    '}',
    'if ($isGateway) {',
    '  # 独立 Gateway Agent 使用自己的中继配置，不复用 Full Agent 的授权字段。',
    '  $config.Remove("authorizationMaterialPath")',
    '  $config.Remove("authorizationTrustKeySet")',
    '  $config.relayEnabled = $true',
    '  $config.relayListenAddress = "0.0.0.0"',
    '  $config.relayPort = 18934',
    '  $config.relayClientPublicKeys = @(if ($null -eq $manifest.relayClientPublicKeys) { @() } else { $manifest.relayClientPublicKeys })',
    '  $config.relayAllowedTargets = [string[]]@(if ($null -eq $manifest.relayAllowedTargets) { @() } else { $manifest.relayAllowedTargets })',
    '  $config.relayAllowedPorts = [int[]]@(if ($null -eq $manifest.relayAllowedPorts) { @() } else { $manifest.relayAllowedPorts })',
    '  $config.relayIdleTimeoutSeconds = 300',
    '}',
    'New-Item -ItemType Directory -Force -Path $manifest.configDir, $manifest.dataDir, $manifest.logDir, $policyDir | Out-Null',
    '& icacls.exe $policyDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)" | Out-Null',
    'if ($LASTEXITCODE -ne 0) { throw "Go Agent policy directory ACL configuration failed: $policyDir" }',
    '[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), $utf8Bom)',
    'New-Item -ItemType Directory -Force -Path $manifest.installRoot | Out-Null',
    'Copy-Item -LiteralPath $agentSource -Destination $agentTarget -Force',
    'if (-not $isGateway) {',
    '  Copy-Item -LiteralPath $updaterSource -Destination $updaterTarget -Force',
    '  $pluginTarget = Join-Path $manifest.installRoot "plugins/windows-runtime-discovery.exe"',
    '  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pluginTarget) | Out-Null',
    '  Copy-Item -LiteralPath $pluginSource -Destination $pluginTarget -Force',
    '}',
    '$serviceRunVerb = if ($isGateway) { "run" } else { "service run" }',
    '$serviceCommand = "`"" + $agentTarget + "`" " + $serviceRunVerb + " --config=`"" + $configPath + "`""',
    '$serviceDescription = if ($isGateway) { "GCAC Gateway Agent service" } else { "GCAC Windows Go Full Agent service" }',
    'New-Service -Name ([string]$manifest.serviceName) -BinaryPathName $serviceCommand -DisplayName ([string]$manifest.displayName) -Description $serviceDescription -StartupType Automatic | Out-Null',
    'sc.exe failure ([string]$manifest.serviceName) reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null',
    'sc.exe failureflag ([string]$manifest.serviceName) 1 | Out-Null',
    '$metadata = [ordered]@{ ServiceName = [string]$manifest.serviceName; DisplayName = [string]$manifest.displayName; InstallRoot = [string]$manifest.installRoot; ConfigPath = [string]$configPath; DataDir = [string]$manifest.dataDir; LogDir = [string]$manifest.logDir; BinaryPath = [string]$agentTarget; InstalledAt = (Get-Date).ToString("o"); Mode = "windows-service-go-bootstrap" }',
    'New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifest.configDir) | Out-Null',
    '[System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 5), $utf8Bom)',
    '$agentExe = Join-Path $manifest.installRoot $binaryName',
    'if (-not $isGateway) {',
    '  & $agentExe register-once --config=$configPath',
    '  if ($LASTEXITCODE -ne 0) { throw "Agent registration or initial capability report failed. See the preceding Agent error." }',
    '}',
    'if ([bool]$manifest.startAfterInstall) {',
    '  try {',
    '    Start-Service -Name ([string]$manifest.serviceName) -ErrorAction Stop',
    '  } catch {',
    '    $serviceState = (& sc.exe queryex ([string]$manifest.serviceName) | Out-String)',
    '    $agentLogPath = Join-Path ([string]$manifest.logDir) "agent.log"',
    '    $agentLogTail = if (Test-Path -LiteralPath $agentLogPath) { Get-Content -LiteralPath $agentLogPath -Tail 40 | Out-String } else { "Agent log was not created." }',
    '    throw "GCAC Windows Go Agent service failed to start: $([string]$manifest.serviceName)`n$serviceState`nAgent log tail:`n$agentLogTail"',
    '  }',
    '}',
    "Write-Host 'GCAC Windows Agent bootstrap completed: ' + $binaryName",
  ].join('\r\n');
}

function renderWindowsCompatibilityBootstrapScript(manifest: unknown): string {
  const manifestJson = JSON.stringify(manifest, null, 2);
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Web.Extensions',
    '$jsonSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer',
    "$manifest = @'",
    manifestJson,
    "'@",
    '$manifest = $jsonSerializer.DeserializeObject($manifest)',
    '$utf8NoBom = New-Object System.Text.UTF8Encoding($false)',
    "$root = Join-Path $env:TEMP ('gcac-windows-compatibility-agent-' + [string]$manifest['sessionId'])",
    'New-Item -ItemType Directory -Force -Path $root | Out-Null',
    "foreach ($artifact in $manifest['artifacts']) {",
    "  $path = Join-Path $root ([string]$artifact['path'])",
    '  $dir = Split-Path -Parent $path',
    '  New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    "  if ([string]$artifact['encoding'] -eq 'base64') {",
    "    [System.IO.File]::WriteAllBytes($path, [System.Convert]::FromBase64String([string]$artifact['content']))",
    '  } else {',
    "    [System.IO.File]::WriteAllText($path, [string]$artifact['content'], $utf8NoBom)",
    '  }',
    '}',
    "$installRoot = [string]$manifest['installRoot']",
    "$configDir = [string]$manifest['configDir']",
    "$dataDir = [string]$manifest['dataDir']",
    "$logDir = [string]$manifest['logDir']",
    '$serviceName = "GCACWindowsCompatibilityAgent"',
    '$displayName = "GCAC Windows Compatibility Agent"',
    '$agentSource = Join-Path $root "GCAC.WindowsCompatibilityAgent.exe"',
    '$configSource = Join-Path $root "GCAC.WindowsCompatibilityAgent.exe.config"',
    'if (-not (Test-Path -LiteralPath $agentSource)) { throw "Compatibility Agent executable is missing from the bootstrap bundle." }',
    'if (-not (Test-Path -LiteralPath $configSource)) { throw "Compatibility Agent runtime config is missing from the bootstrap bundle." }',
    'function Remove-CompatibilityService {',
    '  $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue',
    '  if ($null -eq $existing) { return }',
    '  if ($existing.Status -ne "Stopped") {',
    '    Stop-Service -Name $serviceName -Force -ErrorAction Stop',
    '    $existing.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))',
    '  }',
    '  $existing.Close()',
    '  & sc.exe delete $serviceName | Out-Null',
    '  if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent service deletion failed: $serviceName" }',
    '  $deadline = [DateTime]::UtcNow.AddSeconds(30)',
    '  do {',
    '    $remaining = Get-Service -Name $serviceName -ErrorAction SilentlyContinue',
    '    if ($null -eq $remaining) { return }',
    '    $remaining.Close()',
    '    Start-Sleep -Milliseconds 250',
    '  } while ([DateTime]::UtcNow -lt $deadline)',
    '  throw "Compatibility Agent service deletion timed out: $serviceName"',
    '}',
    'Remove-CompatibilityService',
    'New-Item -ItemType Directory -Force -Path $installRoot, $configDir, $dataDir, $logDir | Out-Null',
    '$agentTarget = Join-Path $installRoot "GCAC.WindowsCompatibilityAgent.exe"',
    '$runtimeConfigTarget = Join-Path $installRoot "GCAC.WindowsCompatibilityAgent.exe.config"',
    'Copy-Item -LiteralPath $agentSource -Destination $agentTarget -Force',
    'Copy-Item -LiteralPath $configSource -Destination $runtimeConfigTarget -Force',
    '& netsh.exe advfirewall firewall delete rule name="GCAC Windows Compatibility Agent Management TCP 18932" 2>$null | Out-Null',
    '& netsh.exe advfirewall firewall add rule name="GCAC Windows Compatibility Agent Management TCP 18932" dir=in action=allow protocol=TCP localport=18932 program="$agentTarget" profile=any | Out-Null',
    'if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent firewall rule creation failed: 18932" }',
    '$configPath = Join-Path $configDir "agent.config.json"',
    '$policyDir = Join-Path $dataDir "policy"',
    'function Serialize-JsonString {',
    '  param([object]$Value)',
    '  return $jsonSerializer.Serialize([string]$Value)',
    '}',
    '$configJson = @(',
    "  '{',",
    "  ('\"schemaVersion\":' + (Serialize-JsonString 'gcac.windows-compat-agent-config/v1') + ','),",
    "  ('\"tenantId\":' + (Serialize-JsonString ([string]$manifest['tenantId'])) + ','),",
    "  ('\"agentKey\":' + (Serialize-JsonString ([string]$manifest['agentKey'])) + ','),",
    "  ('\"enrollmentToken\":' + (Serialize-JsonString ([string]$manifest['enrollmentToken'])) + ','),",
    "  ('\"controlPlaneUrl\":' + (Serialize-JsonString ([string]$manifest['controlPlaneUrl'])) + ','),",
    '  \'"heartbeatIntervalSeconds":10,\',',
    '  \'"taskPollIntervalSeconds":5,\',',
    '  \'"managementListenAddress":"0.0.0.0",\',',
    '  \'"managementPort":18932,\',',
    '  \'"requiredHotfixes":[],\',',
    "  ('\"dataDirectory\":' + (Serialize-JsonString $dataDir) + ','),",
    "  ('\"logDirectory\":' + (Serialize-JsonString $logDir) + ','),",
    "  ('\"policyTrustRootPath\":' + (Serialize-JsonString (Join-Path $policyDir 'trust-root.json')) + ','),",
    "  ('\"policyKeySetPath\":' + (Serialize-JsonString (Join-Path $policyDir 'key-set.json')) + ','),",
    "  ('\"localPolicyTrustRootPath\":' + (Serialize-JsonString (Join-Path $policyDir 'local-policy-root.json')) + ','),",
    "  ('\"localPolicyPath\":' + (Serialize-JsonString (Join-Path $policyDir 'local-policy.json')) + ','),",
    "  ('\"revokedTokenIdsPath\":' + (Serialize-JsonString (Join-Path $policyDir 'revoked-tokens.json')) + ','),",
    "  ('\"revokedDecisionIdsPath\":' + (Serialize-JsonString (Join-Path $policyDir 'revoked-decisions.json')) + ','),",
    "  ('\"revokedKeyIdsPath\":' + (Serialize-JsonString (Join-Path $policyDir 'revoked-keys.json')) + ','),",
    '  \'"receiptKeyId":"agent-receipt-key-id"\',',
    "  (',\"receiptSigningKeyPath\":' + (Serialize-JsonString (Join-Path $policyDir 'agent-receipt-signing-key.bin')) + ','),",
    "  ('\"receiptKeySetPath\":' + (Serialize-JsonString (Join-Path $policyDir 'agent-receipt-keyset.json'))),",
    "  '}'",
    ") -join ''",
    '[System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)',
    '$serviceCommand = "`"" + $agentTarget + "`" --config `"" + $configPath + "`""',
    'New-Service -Name $serviceName -BinaryPathName $serviceCommand -DisplayName $displayName -StartupType Automatic | Out-Null',
    '$serviceRegistryPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\" + $serviceName',
    'Set-ItemProperty -LiteralPath $serviceRegistryPath -Name Description -Value "GCAC compatibility product line for Windows Server 2008 R2 SP1 through 2012 R2" -ErrorAction Stop',
    'sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000 | Out-Null',
    '$metadataPath = Join-Path (Split-Path -Parent $configDir) "service.install.json"',
    '$metadataJson = @(',
    "  '{',",
    "  ('\"ServiceName\":' + (Serialize-JsonString $serviceName) + ','),",
    "  ('\"DisplayName\":' + (Serialize-JsonString $displayName) + ','),",
    "  ('\"InstallRoot\":' + (Serialize-JsonString $installRoot) + ','),",
    "  ('\"ConfigPath\":' + (Serialize-JsonString $configPath) + ','),",
    "  ('\"DataDir\":' + (Serialize-JsonString $dataDir) + ','),",
    "  ('\"LogDir\":' + (Serialize-JsonString $logDir) + ','),",
    "  ('\"BinaryPath\":' + (Serialize-JsonString $agentTarget) + ','),",
    '  (\'"InstalledAt":\' + (Serialize-JsonString ((Get-Date).ToString("o"))) + \',\'),',
    '  \'"Mode":"windows-service-compatibility-bootstrap"\',',
    "  '}'",
    ") -join ''",
    '[System.IO.File]::WriteAllText($metadataPath, $metadataJson, $utf8NoBom)',
    "if ([bool]$manifest['startAfterInstall']) { Start-Service -Name $serviceName }",
  ].join('\r\n');
}

function renderLinuxBootstrapScript(manifest: unknown): string {
  const manifestJson = JSON.stringify(manifest, null, 2);
  const installManifest = manifest as {
    role?: string;
    gatewayBundleUrl?: string;
    bundleUrl?: string;
    serviceName?: string;
    displayName?: string;
    installRoot?: string;
    configDir?: string;
    dataDir?: string;
    logDir?: string;
    startAfterInstall?: boolean;
  };
  const isGateway = installManifest.role === 'gateway';
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
    'cat <<\'JSON\' > "$WORKDIR/manifest.json"',
    manifestJson,
    'JSON',
    'MANIFEST_PATH="$WORKDIR/manifest.json" node <<\'NODE\'',
    'const fs = require("node:fs");',
    'const path = process.env.MANIFEST_PATH;',
    'const manifest = JSON.parse(fs.readFileSync(path, "utf8"));',
    'const isGateway = manifest.role === "gateway";',
    'const config = {',
    '  schemaVersion: isGateway ? "gcac.gateway-agent.v1" : "full-agent.linux-go.config.v1",',
    '  tenantId: manifest.tenantId,',
    '  agentKey: manifest.agentKey,',
    '  enrollmentToken: manifest.enrollmentToken,',
    '  zone: manifest.zone,',
    '  controlPlaneUrl: manifest.controlPlaneUrl,',
    '  heartbeatIntervalSeconds: 10,',
    '  taskPollIntervalSeconds: 60,',
    '  healthCheckIntervalSeconds: 30,',
    '  offlineTimeoutSeconds: 180,',
    '  managementListenAddress: "0.0.0.0",',
    '  managementPort: isGateway ? 18935 : 18931,',
    '  authorizationTrustKeySet: manifest.authorizationTrustKeySet || {},',
    '  paths: { linux: { configPath: `${manifest.configDir}/agent.config.json`, dataDir: manifest.dataDir, logDir: manifest.logDir } },',
    '  service: { name: manifest.serviceName, displayName: manifest.displayName },',
    '};',
    'if (isGateway) {',
    '  // 独立 Gateway Agent：独立中继端口 18934 + 控制面中继公钥，无 Full Agent 字段。',
    '  config.relayEnabled = true;',
    '  config.relayListenAddress = "0.0.0.0";',
    '  config.relayPort = 18934;',
    '  config.relayClientPublicKeys = manifest.relayClientPublicKeys || [];',
    '  config.relayAllowedTargets = manifest.relayAllowedTargets || [];',
    '  config.relayAllowedPorts = manifest.relayAllowedPorts || [];',
    '  config.relayIdleTimeoutSeconds = 300;',
    '} else {',
    '  config.capabilityRescanIntervalSeconds = 300;',
    '  config.capabilityRescanEnabled = true;',
    '  config.authorizationMaterialPath = `${manifest.dataDir}/policy/agent-trust-material.json`;',
    '}',
    'fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\\n");',
    'NODE',
    '',
    `BUNDLE_URL=${toBashSingleQuoted(isGateway ? (installManifest.gatewayBundleUrl ?? '') : (installManifest.bundleUrl ?? ''))}`,
    `SERVICE_NAME=${toBashSingleQuoted(installManifest.serviceName ?? (isGateway ? 'gcac-gateway-agent' : 'gcac-linux-agent'))}`,
    `DISPLAY_NAME=${toBashSingleQuoted(installManifest.displayName ?? (isGateway ? 'GCAC Gateway Agent' : 'GCAC Linux Go Full Agent'))}`,
    `INSTALL_ROOT=${toBashSingleQuoted(installManifest.installRoot ?? (isGateway ? '/opt/gcac/gateway' : '/opt/gcac/linux-agent'))}`,
    `CONFIG_DIR=${toBashSingleQuoted(installManifest.configDir ?? (isGateway ? '/etc/gcac/gateway' : '/etc/gcac/linux-agent'))}`,
    `DATA_DIR=${toBashSingleQuoted(installManifest.dataDir ?? (isGateway ? '/var/lib/gcac/gateway' : '/var/lib/gcac/linux-agent'))}`,
    `LOG_DIR=${toBashSingleQuoted(installManifest.logDir ?? (isGateway ? '/var/log/gcac/gateway' : '/var/log/gcac/linux-agent'))}`,
    `START_AFTER_INSTALL=${toBashSingleQuoted(installManifest.startAfterInstall === true ? 'true' : 'false')}`,
    `BINARY_NAME=${toBashSingleQuoted(isGateway ? 'gcac-gateway-agent' : 'gcac-linux-agent')}`,
    '',
    'curl -fsSL "$BUNDLE_URL" -o "$WORKDIR/bundle.tar.gz"',
    'tar -xzf "$WORKDIR/bundle.tar.gz" -C "$WORKDIR"',
    'install -d "$WORKDIR/config"',
    'install -m 0644 "$WORKDIR/manifest.json" "$WORKDIR/config/agent.config.template.json"',
    'chmod +x "$WORKDIR/linux/install-systemd.sh"',
    'GCAC_SKIP_RELEASE_SIGNATURE_VERIFY=bootstrap-fixed-bundle SERVICE_NAME="$SERVICE_NAME" DISPLAY_NAME="$DISPLAY_NAME" INSTALL_ROOT="$INSTALL_ROOT" CONFIG_DIR="$CONFIG_DIR" DATA_DIR="$DATA_DIR" LOG_DIR="$LOG_DIR" START_AFTER_INSTALL="$START_AFTER_INSTALL" bash "$WORKDIR/linux/install-systemd.sh"',
    '"$INSTALL_ROOT/$BINARY_NAME" self-check --config "$CONFIG_DIR/agent.config.json"',
    'echo "GCAC Agent bootstrap completed: $BINARY_NAME"',
  ].join('\n');
}

function toBashSingleQuoted(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
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
