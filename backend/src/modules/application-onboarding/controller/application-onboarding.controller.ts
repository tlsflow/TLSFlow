import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { ApplicationOnboardingService } from '../application/application-onboarding.service.js';

const tags = ['ApplicationOnboarding'];

export class ApplicationOnboardingController {
  constructor(private readonly service: ApplicationOnboardingService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/application-onboarding/platforms', '查询应用接入平台', tags, (request) => this.listPlatforms(request));
    router.post('/api/v1/application-onboarding/sessions', '创建应用接入会话', tags, (request) => this.createSession(request));
    router.get('/api/v1/application-onboarding/sessions/:id', '查询应用接入会话', tags, (request) => this.getSession(request));
    router.get('/api/v1/application-onboarding/sessions/:id/devices', '查询可选择接入设备', tags, (request) => this.devices(request));
    router.get('/api/v1/application-onboarding/sessions/:id/certificate-options', '查询平台可用的证书选项', tags, (request) => this.certificateOptions(request));
    router.post('/api/v1/application-onboarding/sessions/:id/resource-selection', '选择接入设备来源', tags, (request) => this.selectResource(request));
    router.post('/api/v1/application-onboarding/sessions/:id/test', '测试接入设备连接', tags, (request) => this.test(request));
    router.post('/api/v1/application-onboarding/sessions/:id/discover', '扫描接入站点', tags, (request) => this.discover(request));
    router.get('/api/v1/application-onboarding/sessions/:id/targets', '查询业务化站点', tags, (request) => this.targets(request));
    router.post('/api/v1/application-onboarding/sessions/:id/target-selection', '选择业务化站点', tags, (request) => this.selectTarget(request));
    router.post('/api/v1/application-onboarding/sessions/:id/certificate-selection', '选择证书版本', tags, (request) => this.selectCertificate(request));
    router.post('/api/v1/application-onboarding/sessions/:id/complete', '完成应用接入', tags, (request) => this.complete(request));
    router.post('/api/v1/application-onboarding/sessions/:id/cancel', '取消应用接入', tags, (request) => this.cancel(request));
  }

  private async listPlatforms(request: HttpRequest) {
    await this.assertRead(request);
    const locale = typeof request.query.locale === 'string' ? request.query.locale : 'zh-CN';
    return this.service.listPlatforms(requireTenantId(request), locale);
  }

  private async createSession(request: HttpRequest) {
    const subject = await this.assertWrite(request);
    const body = validateObject(request.body, {
      platformKey: { type: 'string', required: true },
    });
    const idempotencyKey = requireIdempotencyKey(request);
    return { statusCode: 201, body: await this.service.createSession(requireTenantId(request), subject.id, { platformKey: String(body.platformKey), idempotencyKey }) };
  }

  private async getSession(request: HttpRequest) {
    await this.assertRead(request);
    return this.service.getSession(requireTenantId(request), this.sessionId(request));
  }

  private async devices(request: HttpRequest) {
    await this.assertRead(request);
    return { items: await this.service.devices(requireTenantId(request), this.sessionId(request)) };
  }

  private async certificateOptions(request: HttpRequest) {
    await this.assertRead(request);
    const certificateAssetId = typeof request.query.certificateAssetId === 'string' ? request.query.certificateAssetId : undefined;
    return this.service.certificateOptions(requireTenantId(request), this.sessionId(request), certificateAssetId);
  }

  private async selectResource(request: HttpRequest) {
    const subject = await this.assertWrite(request);
    const body = validateObject(request.body, {
      expectedStateVersion: { type: 'number', required: true },
      mode: { type: 'string', required: true, enum: ['EXISTING_DEVICE', 'NEW_DEVICE'] },
      deviceId: { type: 'string' }, values: { type: 'object' },
    });
    if (body.mode === 'NEW_DEVICE') await this.assertPermission(request, 'credential.create');
    return this.service.selectResource(requireTenantId(request), this.sessionId(request), {
      expectedStateVersion: Number(body.expectedStateVersion),
      mode: body.mode as 'EXISTING_DEVICE' | 'NEW_DEVICE',
      deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
      values: (body.values ?? {}) as Record<string, unknown>,
    });
  }

  private async test(request: HttpRequest) {
    await this.assertWrite(request);
    const body = stateVersionBody(request);
    return this.service.test(requireTenantId(request), this.sessionId(request), body);
  }

  private async discover(request: HttpRequest) {
    await this.assertWrite(request);
    const body = stateVersionBody(request);
    return this.service.discover(requireTenantId(request), this.sessionId(request), body);
  }

  private async targets(request: HttpRequest) {
    await this.assertRead(request);
    return { items: await this.service.targets(requireTenantId(request), this.sessionId(request)) };
  }

  private async selectTarget(request: HttpRequest) {
    await this.assertWrite(request);
    const body = validateObject(request.body, {
      expectedStateVersion: { type: 'number', required: true },
      managedTargetId: { type: 'string', required: true },
      configFingerprint: { type: 'string', required: true },
      accessDomain: { type: 'string' },
      verifyUrl: { type: 'string' },
      inputBindings: { type: 'object' },
    });
    const input = {
      expectedStateVersion: body.expectedStateVersion,
      managedTargetId: body.managedTargetId,
      configFingerprint: body.configFingerprint,
      ...(typeof body.accessDomain === 'string' ? { accessDomain: body.accessDomain } : {}),
      ...(typeof body.verifyUrl === 'string' ? { verifyUrl: body.verifyUrl } : {}),
      ...(body.inputBindings && typeof body.inputBindings === 'object' && !Array.isArray(body.inputBindings)
        ? { inputBindings: body.inputBindings }
        : {}),
    };
    return this.service.selectTarget(requireTenantId(request), this.sessionId(request), input as never);
  }

  private async selectCertificate(request: HttpRequest) {
    await this.assertWrite(request);
    const body = validateObject(request.body, { expectedStateVersion: { type: 'number', required: true }, certificateId: { type: 'string', required: true }, certificateVersionId: { type: 'string', required: true }, selectionMode: { type: 'string', enum: ['EXPLICIT', 'LATEST_AUTO'] } });
    return this.service.selectCertificate(requireTenantId(request), this.sessionId(request), body as never);
  }

  private async complete(request: HttpRequest) {
    await this.assertWrite(request);
    const body = validateObject(request.body, { expectedStateVersion: { type: 'number', required: true } });
    const idempotencyKey = readIdempotencyKey(request) ?? `onboarding-complete:${this.sessionId(request)}`;
    return this.service.complete(requireTenantId(request), this.sessionId(request), { ...body, idempotencyKey } as never);
  }

  private async cancel(request: HttpRequest) {
    await this.assertWrite(request);
    return this.service.cancel(requireTenantId(request), this.sessionId(request), stateVersionBody(request));
  }

  private async assertRead(request: HttpRequest): Promise<SecuritySubject> {
    return this.assertPermission(request, 'service_asset.read');
  }

  private async assertWrite(request: HttpRequest): Promise<SecuritySubject> {
    return this.assertPermission(request, 'service_asset.manage');
  }

  private async assertPermission(request: HttpRequest, action: string): Promise<SecuritySubject> {
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, action, {
      type: 'applicationAsset',
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    return subject;
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private sessionId(request: HttpRequest): string {
    const id = request.path.match(/^\/api\/v1\/application-onboarding\/sessions\/([^/]+)/)?.[1];
    if (!id) throw new AppError('VALIDATION_FAILED', '接入会话 ID 无效');
    return decodeURIComponent(id);
  }
}

function header(request: HttpRequest, key: string): string | undefined {
  const value = request.headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function readIdempotencyKey(request: HttpRequest): string | undefined {
  return header(request, 'x-idempotency-key') ?? header(request, 'idempotency-key');
}

function requireIdempotencyKey(request: HttpRequest): string {
  const value = readIdempotencyKey(request)?.trim();
  if (!value) {
    throw new AppError('VALIDATION_FAILED', '创建接入会话必须提供 X-Idempotency-Key', {
      code: 'ONBOARDING_IDEMPOTENCY_KEY_REQUIRED',
    });
  }
  return value;
}

function stateVersionBody(request: HttpRequest): { expectedStateVersion: number; idempotencyKey?: string } {
  const body = validateObject(request.body, { expectedStateVersion: { type: 'number', required: true } });
  return { expectedStateVersion: Number(body.expectedStateVersion), idempotencyKey: readIdempotencyKey(request) };
}

export function getApplicationOnboardingRouteContracts(): RouteContract[] {
  const schema = { type: 'object', additionalProperties: true } as const;
  return [
    { method: 'GET', path: '/api/v1/application-onboarding/platforms', operationId: 'listApplicationOnboardingPlatforms', summary: '查询应用接入平台', tags, responseSchema: { type: 'array', items: schema } },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions', operationId: 'createApplicationOnboardingSession', summary: '创建应用接入会话', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/application-onboarding/sessions/:id', operationId: 'getApplicationOnboardingSession', summary: '查询应用接入会话', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/application-onboarding/sessions/:id/devices', operationId: 'listApplicationOnboardingDevices', summary: '查询可选择接入设备', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/application-onboarding/sessions/:id/certificate-options', operationId: 'listApplicationOnboardingCertificateOptions', summary: '查询平台可用的证书选项', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions/:id/resource-selection', operationId: 'selectApplicationOnboardingResource', summary: '选择接入设备来源', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions/:id/test', operationId: 'testApplicationOnboardingConnection', summary: '测试接入设备连接', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions/:id/discover', operationId: 'discoverApplicationOnboardingTargets', summary: '扫描接入站点', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/application-onboarding/sessions/:id/targets', operationId: 'listApplicationOnboardingTargets', summary: '查询业务化站点', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions/:id/target-selection', operationId: 'selectApplicationOnboardingTarget', summary: '选择业务化站点', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions/:id/certificate-selection', operationId: 'selectApplicationOnboardingCertificate', summary: '选择证书版本', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions/:id/complete', operationId: 'completeApplicationOnboardingSession', summary: '完成应用接入', tags, responseSchema: schema },
    { method: 'POST', path: '/api/v1/application-onboarding/sessions/:id/cancel', operationId: 'cancelApplicationOnboardingSession', summary: '取消应用接入', tags, responseSchema: schema },
  ];
}
