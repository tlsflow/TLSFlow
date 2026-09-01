import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { AutomationsApplicationService } from '../application/automations.application-service.js';
import { AutomationExternalApiService } from '../application/automation-external-api.service.js';
import type { AutomationExternalApiKeyEntity } from '../schema/automations.schema.js';
import type { AutomationRunCoordinator } from '../application/automation-run-coordinator.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../dto/automations.dto.js';
import { automationPublicSchema } from '../schema/automations.schema.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';

const tags = ['Automations'];

export class AutomationsController {
  constructor(
    private readonly service = new AutomationsApplicationService(),
    private readonly security?: SecurityServices,
    private readonly coordinator?: AutomationRunCoordinator,
    private readonly externalApi?: AutomationExternalApiService,
    private readonly certificates?: CertificatesApplicationService,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/automations', '列出自动化', tags, (request) => this.list(request));
    router.post('/api/v1/automations', '创建自动化', tags, (request) => this.create(request));
    router.get('/api/v1/automations/:id', '获取自动化', tags, (request) => this.get(request));
    router.patch('/api/v1/automations/:id', '更新自动化', tags, (request) => this.update(request));
    router.post('/api/v1/automations/:id/actions/copy', '复制自动化', tags, (request) => this.copy(request));
    router.post('/api/v1/automations/:id/actions/enable', '启用自动化', tags, (request) => this.changeStatus(request, 'enable'));
    router.post('/api/v1/automations/:id/actions/disable', '停用自动化', tags, (request) => this.changeStatus(request, 'disable'));
    router.post('/api/v1/automations/:id/actions/rotate-external-api-key', '刷新自动化外部 API Key', tags, (request) => this.rotateExternalApiKey(request));
    router.delete('/api/v1/automations/:id', '删除自动化', tags, (request) => this.remove(request));
    router.post('/api/v1/automations/:id/preview', '预览自动化目标', tags, (request) => this.preview(request));
    router.post('/api/v1/automations/:id/runs', '按需执行自动化', tags, (request) => this.createRun(request));
    router.post('/api/v1/automation-external/:id/preview', '外部 API 预览自动化目标', tags, (request) => this.externalPreview(request));
    router.post('/api/v1/automation-external/:id/run', '外部 API 执行自动化', tags, (request) => this.externalRun(request));
    router.get('/api/v1/automation-external/:id/certificate-versions', '外部 API 查询可用证书版本', tags, (request) => this.externalCertificateVersions(request));
    router.get('/api/v1/automation-runs', '列出自动化运行', tags, (request) => this.listRuns(request));
    router.get('/api/v1/automation-runs/:id', '获取自动化运行', tags, (request) => this.getRun(request));
    router.get('/api/v1/automation-runs/:id/targets', '列出自动化运行目标', tags, (request) => this.listRunTargets(request));
    router.post('/api/v1/automation-runs/:id/actions/stop', '停止自动化运行', tags, (request) => this.stopRun(request));
    router.post('/api/v1/automation-runs/:id/actions/retry-failed', '重试自动化失败目标', tags, (request) => this.retryRun(request));
  }

  private async preview(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.execute', request, id);
    const body = request.body as { page?: number; pageSize?: number; allowCertificateDowngrade?: boolean; triggerContext?: { certificateAssetId?: string; certificateVersionId?: string; deliveryId?: string; deliveryKey?: string; eventId?: string; eventType?: string; occurredAt?: string; sourceType?: string; domains?: string[]; tags?: string[]; totalMatched?: number; executableCount?: number; excludedCount?: number; excludedReasons?: Record<string, number> } } | undefined;
    return this.service.preview(this.tenantId(request), subject.id, id, body?.page, body?.pageSize, body?.triggerContext, { allowCertificateDowngrade: body?.allowCertificateDowngrade });
  }

  private async createRun(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.execute', request, id);
    const body = request.body as { idempotencyKey?: string; expectedVersion?: number; allowCertificateDowngrade?: boolean; confirmCertificateDowngrade?: boolean; triggerContext?: { certificateVersionId?: string; certificateAssetId?: string; eventId?: string; eventType?: string; sourceType?: string; occurredAt?: string; domains?: string[]; tags?: string[]; totalMatched?: number; executableCount?: number; excludedCount?: number; excludedReasons?: Record<string, number> }; executionOptions?: { stopOnError?: boolean; dryRun?: boolean } };
    if (!body?.idempotencyKey || !Number.isInteger(body.expectedVersion)) throw new AppError('VALIDATION_FAILED', '按需运行必须提供幂等键和期望版本');
    const idempotencyKey = body.idempotencyKey;
    const expectedVersion = Number(body.expectedVersion);
    const run = await this.service.createOnDemandRun(this.tenantId(request), subject.id, id, idempotencyKey, expectedVersion, {
      triggerContext: body.triggerContext,
      executionOptions: body.executionOptions,
      allowCertificateDowngrade: body.allowCertificateDowngrade,
      confirmCertificateDowngrade: body.confirmCertificateDowngrade,
    });
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_EXECUTED, 'automation.execute', run.id, undefined, run);
    return { statusCode: 201, body: run };
  }

  private async externalPreview(request: HttpRequest) {
    const { key, automation } = await this.externalContext(request);
    const body = request.body as { certificateVersionId?: string; page?: number; pageSize?: number } | undefined;
    const certificateVersionId = body?.certificateVersionId?.trim();
    if (!certificateVersionId) throw new AppError('VALIDATION_FAILED', '外部 API 预览必须提供 certificateVersionId');
    return this.service.preview(
      key.tenantId,
      `external:${key.id}`,
      automation.id,
      body?.page,
      body?.pageSize,
      this.externalTriggerContext(automation, certificateVersionId),
    );
  }

  private async externalRun(request: HttpRequest) {
    const { key, automation, configuration } = await this.externalContext(request);
    const body = request.body as {
      certificateVersionId?: string;
      idempotencyKey?: string;
      allowCertificateDowngrade?: boolean;
      confirmCertificateDowngrade?: boolean;
      executionOptions?: { stopOnError?: boolean; dryRun?: boolean };
    } | undefined;
    const certificateVersionId = body?.certificateVersionId?.trim();
    const suppliedIdempotencyKey = body?.idempotencyKey?.trim() || readHeader(request.headers, 'idempotency-key');
    if (!certificateVersionId || !suppliedIdempotencyKey) {
      throw new AppError('VALIDATION_FAILED', '外部 API 执行必须提供 certificateVersionId 和幂等键');
    }
    // 外部幂等键按自动化隔离，避免同一租户不同自动化之间意外复用运行结果。
    const idempotencyKey = `external:${automation.id}:${suppliedIdempotencyKey}`;
    const run = await this.service.createOnDemandRun(
      key.tenantId,
      `external:${key.id}`,
      automation.id,
      idempotencyKey,
      automation.version,
      {
        triggerContext: this.externalTriggerContext(automation, certificateVersionId),
        executionOptions: body?.executionOptions,
        allowCertificateDowngrade: body?.allowCertificateDowngrade,
        confirmCertificateDowngrade: body?.confirmCertificateDowngrade,
        // 中文说明：企业审批在调用方完成，GCAC 外部入口永远创建直接执行运行。
        externalExecutionMode: 'direct',
      },
    );
    return { statusCode: 201, body: run };
  }

  private async externalCertificateVersions(request: HttpRequest) {
    const { key, automation } = await this.externalContext(request);
    if (!this.certificates) throw new Error('certificate service is not configured for automation external API');

    const domains = [...new Set(configuredExternalDomains(automation.configuration.filters))];
    const pages = await Promise.all(domains.map((domain) => this.certificates!.listVersions({
      page: 1,
      pageSize: 1000,
      sort: { field: 'createdAt', direction: 'desc' },
      filter: { primaryDomain: domain, status: 'active' },
    }, key.tenantId)));
    const versions = [...new Map(
      pages.flatMap((page) => page.items)
        .filter((version) => version.deployable)
        .map((version) => [version.id, version]),
    ).values()];

    return {
      items: versions.map((version) => ({
        id: version.id,
        certificateAssetId: version.certificateAssetId,
        versionNo: version.versionNo,
        commonName: version.commonName,
        sans: version.sans,
        notBefore: version.notBefore,
        notAfter: version.notAfter,
        fingerprintSha256: version.fingerprintSha256,
        sourceType: version.sourceType,
        activationState: version.activationState,
        status: version.status,
        deployable: version.deployable,
        createdAt: version.createdAt,
      })),
      total: versions.length,
    };
  }

  private async list(request: HttpRequest) {
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.read', request);
    return { items: await this.service.list(this.tenantId(request)) };
  }

  private async listRuns(request: HttpRequest) {
    const subject = this.subject(request); await this.assertCan(subject, 'automation.read', request);
    return { items: await this.service.listRuns(this.tenantId(request), singleQuery(request.query.automationId)) };
  }

  private async getRun(request: HttpRequest) {
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.read', request, id);
    const run = await this.service.getRun(this.tenantId(request), id);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', '自动化运行不存在', { id });
    return { ...run, actionResults: await this.service.listRunActionResults(this.tenantId(request), id) };
  }

  private async listRunTargets(request: HttpRequest) {
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.read', request, id);
    return { items: await this.service.listRunTargets(this.tenantId(request), id) };
  }

  private async stopRun(request: HttpRequest) {
    if (!this.coordinator) throw new Error('automation coordinator is not configured');
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.stop', request, id);
    const run = await this.coordinator.stop(id, this.tenantId(request));
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_STOPPED, 'automation.stop', id, undefined, run);
    return run;
  }

  private async retryRun(request: HttpRequest) {
    if (!this.coordinator) throw new Error('automation coordinator is not configured');
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.retry', request, id);
    const key = String((request.body as { idempotencyKey?: string })?.idempotencyKey ?? '');
    if (!key) throw new AppError('VALIDATION_FAILED', '重试必须提供幂等键');
    const run = await this.coordinator.retryFailed(id, this.tenantId(request), subject.id, key);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_RETRIED, 'automation.retry', run.id, { parentRunId: id }, run);
    return { statusCode: 201, body: run };
  }

  private async get(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.read', request, id);
    return this.service.get(this.tenantId(request), id);
  }

  private async create(request: HttpRequest) {
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.create', request);
    const created = await this.service.create(this.tenantId(request), subject.id, request.body as CreateAutomationInput);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_CREATED, 'automation.create', created.id, undefined, created);
    return { statusCode: 201, body: created };
  }

  private async update(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.update', request, id);
    const before = await this.service.get(this.tenantId(request), id);
    const updated = await this.service.update(this.tenantId(request), subject.id, id, request.body as UpdateAutomationInput);
    if (this.externalApi && before.configuration.trigger.type === 'api' && updated.configuration.trigger.type !== 'api') {
      await this.externalApi.revoke(this.tenantId(request), id);
    }
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_UPDATED, 'automation.update', id, before, updated);
    return updated;
  }

  private async copy(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.create', request, id);
    const copied = await this.service.copy(this.tenantId(request), subject.id, id);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_COPIED, 'automation.create', copied.id, { sourceId: id }, copied);
    return { statusCode: 201, body: copied };
  }

  private async changeStatus(request: HttpRequest, action: 'enable' | 'disable') {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.update', request, id);
    const before = await this.service.get(this.tenantId(request), id);
    const expectedVersion = Number((request.body as { expectedVersion?: number })?.expectedVersion);
    const updated = action === 'enable'
      ? await this.service.enable(this.tenantId(request), id, expectedVersion)
      : await this.service.disable(this.tenantId(request), id, expectedVersion);
    let response: unknown = updated;
    if (action === 'enable') {
      const current = await this.service.get(this.tenantId(request), id);
      if (current.configuration.trigger.type === 'api') {
        if (!this.externalApi) throw new Error('automation external API service is not configured');
        // 中文说明：外部企业入口固定为直接执行；旧配置中的 approval 仅保留读取兼容，不得继续签发为有效模式。
        const issued = await this.externalApi.issue({ tenantId: this.tenantId(request), automationId: id, createdBy: subject.id, executionMode: 'direct' });
        response = { ...updated, externalApiKey: issued.key, externalApiKeyPrefix: issued.keyPrefix, externalApiExecutionMode: issued.executionMode };
      }
    } else if (this.externalApi) {
      await this.externalApi.revoke(this.tenantId(request), id);
    }
    // 明文 Key 只返回给启用请求，绝不能写入审计详情。
    await this.audit(request, subject, action === 'enable' ? AUDIT_EVENT_TYPES.AUTOMATION_ENABLED : AUDIT_EVENT_TYPES.AUTOMATION_DISABLED, 'automation.update', id, before, updated);
    return response;
  }

  private async rotateExternalApiKey(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.update', request, id);
    if (!this.externalApi) throw new Error('automation external API service is not configured');

    const automation = await this.service.get(this.tenantId(request), id);
    if (automation.status !== 'active') throw new AppError('VALIDATION_FAILED', '只有已启用的自动化才能刷新外部 API Key');
    if (automation.configuration.trigger.type !== 'api') throw new AppError('VALIDATION_FAILED', '只有 API 触发的自动化才能刷新外部 API Key');

    const issued = await this.externalApi.issue({
      tenantId: this.tenantId(request),
      automationId: id,
      createdBy: subject.id,
      // 中文说明：轮换后的 Key 只能绑定外部直接执行语义，避免旧版本配置重新启用内部审批。
      executionMode: 'direct',
    });
    await this.audit(
      request,
      subject,
      AUDIT_EVENT_TYPES.AUTOMATION_EXTERNAL_API_KEY_ROTATED,
      'automation.update',
      id,
      undefined,
      { keyPrefix: issued.keyPrefix, executionMode: issued.executionMode },
    );
    return {
      statusCode: 200,
      body: {
        ...automation,
        externalApiKey: issued.key,
        externalApiKeyPrefix: issued.keyPrefix,
        externalApiExecutionMode: issued.executionMode,
      },
    };
  }

  private async externalContext(request: HttpRequest): Promise<{ key: AutomationExternalApiKeyEntity; automation: Awaited<ReturnType<AutomationsApplicationService['get']>>; configuration: Awaited<ReturnType<AutomationsApplicationService['get']>>['configuration'] }> {
    if (!this.externalApi) throw new Error('automation external API service is not configured');
    const key = await this.externalApi.authenticate(readHeader(request.headers, 'x-automation-api-key'));
    const id = externalPathId(request);
    if (key.automationId !== id) throw new AppError('AUTH_UNAUTHENTICATED', '自动化 API Key 与目标不匹配');
    const automation = await this.service.get(key.tenantId, id);
    if (automation.status !== 'active') throw new AppError('AUTH_FORBIDDEN', '自动化未启用');
    if (automation.configuration.trigger.type !== 'api') throw new AppError('VALIDATION_FAILED', '当前自动化未配置为外部 API 触发');
    if (configuredExternalDomains(automation.configuration.filters).length === 0) {
      throw new AppError('VALIDATION_FAILED', '外部 API 触发器必须预设至少一个证书域名');
    }
    return { key, automation, configuration: automation.configuration };
  }

  private externalTriggerContext(automation: Awaited<ReturnType<AutomationsApplicationService['get']>>, certificateVersionId: string) {
    const domains = configuredExternalDomains(automation.configuration.filters);
    return { certificateVersionId, ...(domains?.length ? { domains: [...new Set(domains)] } : {}), sourceType: 'external_api' };
  }

  private async remove(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.delete', request, id);
    const before = await this.service.get(this.tenantId(request), id);
    const expectedVersion = Number((request.body as { expectedVersion?: number })?.expectedVersion ?? request.query.expectedVersion);
    const deleted = await this.service.delete(this.tenantId(request), id, expectedVersion);
    if (this.externalApi) await this.externalApi.revoke(this.tenantId(request), id);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_DELETED, 'automation.delete', id, before, deleted);
    return deleted;
  }

  private subject(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_automations', type: 'system', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private tenantId(request: HttpRequest): string {
    return requireTenantId(request);
  }

  private assertCan(subject: SecuritySubject, action: string, request: HttpRequest, id?: string): Promise<void> {
    if (!this.security) return Promise.resolve();
    return this.security.rbac.assertCan(subject, action, { type: 'automation', id, scope: { tenantId: this.tenantId(request), tenantScope: request.context.tenantScope, ownerId: subject.id } }, {
      requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject,
    });
  }

  private async audit(request: HttpRequest, subject: SecuritySubject, eventType: string, action: string, id: string, before: unknown, after: unknown): Promise<void> {
    await this.security?.audit.write({
      eventType, actorType: subject.type === 'system' ? 'system' : 'user', actorId: subject.id, action,
      resourceType: 'automation', resourceId: id, result: 'success', riskLevel: action === 'automation.delete' ? 'high' : 'medium',
      context: { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject }, detail: { before, after },
      failClosed: true,
    });
  }
}

function pathId(request: HttpRequest): string {
  const id = request.path.match(/^\/api\/v1\/automations\/([^/]+)/)?.[1];
  if (!id) throw new AppError('VALIDATION_FAILED', '缺少自动化 ID');
  return decodeURIComponent(id);
}

export function getAutomationRouteContracts(): RouteContract[] {
  return [
    ['GET', '/api/v1/automations', 'listAutomations', '列出自动化'],
    ['POST', '/api/v1/automations', 'createAutomation', '创建自动化'],
    ['GET', '/api/v1/automations/:id', 'getAutomation', '获取自动化'],
    ['PATCH', '/api/v1/automations/:id', 'updateAutomation', '更新自动化'],
    ['POST', '/api/v1/automations/:id/actions/copy', 'copyAutomation', '复制自动化'],
    ['POST', '/api/v1/automations/:id/actions/enable', 'enableAutomation', '启用自动化'],
    ['POST', '/api/v1/automations/:id/actions/disable', 'disableAutomation', '停用自动化'],
    ['POST', '/api/v1/automations/:id/actions/rotate-external-api-key', 'rotateAutomationExternalApiKey', '刷新自动化外部 API Key'],
    ['DELETE', '/api/v1/automations/:id', 'deleteAutomation', '删除自动化'],
    ['POST', '/api/v1/automations/:id/preview', 'previewAutomation', '预览自动化目标'],
    ['POST', '/api/v1/automations/:id/runs', 'createAutomationRun', '按需执行自动化'],
    ['POST', '/api/v1/automation-external/:id/preview', 'previewAutomationExternal', '外部 API 预览自动化目标'],
    ['POST', '/api/v1/automation-external/:id/run', 'runAutomationExternal', '外部 API 执行自动化'],
    ['GET', '/api/v1/automation-external/:id/certificate-versions', 'listAutomationExternalCertificateVersions', '外部 API 查询可用证书版本'],
    ['GET', '/api/v1/automation-runs', 'listAutomationRuns', '列出自动化运行'],
    ['GET', '/api/v1/automation-runs/:id', 'getAutomationRun', '获取自动化运行'],
    ['GET', '/api/v1/automation-runs/:id/targets', 'listAutomationRunTargets', '列出自动化运行目标'],
    ['POST', '/api/v1/automation-runs/:id/actions/stop', 'stopAutomationRun', '停止自动化运行'],
    ['POST', '/api/v1/automation-runs/:id/actions/retry-failed', 'retryAutomationRun', '重试自动化失败目标'],
  ].map(([method, path, operationId, summary]) => ({ method: method as RouteContract['method'], path, operationId, summary, tags, responseSchema: automationPublicSchema }));
}

function runPathId(request: HttpRequest): string {
  const id = request.path.match(/^\/api\/v1\/automation-runs\/([^/]+)/)?.[1];
  if (!id) throw new AppError('VALIDATION_FAILED', '缺少自动化运行 ID');
  return decodeURIComponent(id);
}

function singleQuery(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

function externalPathId(request: HttpRequest): string {
  const id = request.path.match(/^\/api\/v1\/automation-external\/([^/]+)/)?.[1];
  if (!id) throw new AppError('VALIDATION_FAILED', '缺少自动化 ID');
  return decodeURIComponent(id);
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function configuredExternalDomains(filters: Awaited<ReturnType<AutomationsApplicationService['get']>>['configuration']['filters']): string[] {
  return (filters ?? [])
    .filter((filter) => filter.field === 'event.domains')
    .flatMap((filter) => Array.isArray(filter.value) ? filter.value : [filter.value])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase().replace(/\.$/u, ''));
}
