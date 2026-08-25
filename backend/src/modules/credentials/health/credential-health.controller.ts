import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { Router } from '../../../common/http/router.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { CredentialHealthService } from './credential-health.service.js';
import { normalizeCredentialHealthSettings } from '../../../shared/credential-health-settings.js';

export class CredentialHealthController {
  constructor(private readonly service: CredentialHealthService, private readonly security?: SecurityServices) {}
  register(router: Router): void {
    router.get('/api/v1/credentials/health-settings', '查询凭据有效性检测间隔', ['Credentials'], (request) => this.getSettings(request));
    router.patch('/api/v1/credentials/health-settings', '更新凭据有效性检测间隔', ['Credentials'], (request) => this.updateSettings(request));
    router.get('/api/v1/credentials/:id/health', '查询凭据有效性状态', ['Credentials'], (request) => this.health(request));
    router.get('/api/v1/credentials/:id/health-checks', '查询凭据有效性检测详情', ['Credentials'], (request) => this.checks(request));
    router.put('/api/v1/credentials/:id/health-config', '更新凭据有效性检测配置', ['Credentials'], (request) => this.updateConfiguration(request));
    router.post('/api/v1/credentials/:id/health-check', '手动检测凭据有效性', ['Credentials'], (request) => this.manual(request));
  }
  private async health(request: HttpRequest) { const id = pathId(request); await this.authorize(request, 'credential.read', id); return this.service.getHealth(requireTenantId(request), id); }
  private async checks(request: HttpRequest) { const id = pathId(request); await this.authorize(request, 'credential.read', id); return { items: await this.service.listChecks(requireTenantId(request), id, queryString(request, 'deviceAssetId')) }; }
  private async updateConfiguration(request: HttpRequest) {
    const id = pathId(request);
    const subject = await this.authorize(request, 'credential.update', id);
    const body = validateObject(request.body ?? {}, { enabled: { type: 'boolean', required: true }, selectedDeviceAssetId: { type: 'string' } });
    return this.service.updateConfiguration(requireTenantId(request), id, subject.id, {
      enabled: body.enabled === true,
      ...(typeof body.selectedDeviceAssetId === 'string' && body.selectedDeviceAssetId.trim() ? { selectedDeviceAssetId: body.selectedDeviceAssetId.trim() } : {}),
    });
  }
  private async manual(request: HttpRequest) { const id = pathId(request); const subject = await this.authorize(request, 'credential.health-check', id); const body = validateObject(request.body ?? {}, { deviceAssetId: { type: 'string' } }); const result = await this.service.enqueueManual(requireTenantId(request), id, subject.id, typeof body.deviceAssetId === 'string' ? body.deviceAssetId : undefined); return { statusCode: 202, body: { taskId: result.task.id, health: result.health } }; }
  private async getSettings(request: HttpRequest) {
    await this.authorizeSettings(request, 'settings.read');
    const hierarchy = this.security?.tenantHierarchy;
    if (!hierarchy) throw new AppError('TENANT_CONTEXT_INVALID', '租户层级服务未配置');
    return { credentialHealth: await hierarchy.getCredentialHealthSettings(requireTenantId(request)) };
  }
  private async updateSettings(request: HttpRequest) {
    const subject = await this.authorizeSettings(request, 'settings.write');
    const body = validateObject(request.body ?? {}, { intervalMinutes: { type: 'number', required: true } });
    const intervalMinutes = Number(body.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 43_200) {
      throw new AppError('VALIDATION_FAILED', '检测间隔必须是 1 到 43200 分钟之间的整数', { field: 'intervalMinutes' });
    }
    const hierarchy = this.security?.tenantHierarchy;
    if (!hierarchy) throw new AppError('TENANT_CONTEXT_INVALID', '租户层级服务未配置');
    const tenantId = requireTenantId(request);
    const updated = await hierarchy.updateCredentialHealthSettings(tenantId, { intervalMinutes }, subject.id, tenantId);
    return { credentialHealth: normalizeCredentialHealthSettings(updated.settings.credentialHealth) };
  }
  private async authorizeSettings(request: HttpRequest, action: 'settings.read' | 'settings.write'): Promise<SecuritySubject> {
    if (this.security && !request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    const subject = { id: request.context.actorId ?? 'system_credentials', type: request.context.actorId ? 'user' as const : 'system' as const, scope: { tenantId: requireTenantId(request), tenantScope: request.context.tenantScope } };
    await this.security?.rbac.assertCan(subject, action, { type: 'settings', id: requireTenantId(request), scope: subject.scope }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    return subject;
  }
  private async authorize(request: HttpRequest, action: string, id: string): Promise<SecuritySubject> { const subject = { id: request.context.actorId ?? 'system_credentials', type: request.context.actorId ? 'user' as const : 'system' as const, scope: { tenantId: requireTenantId(request), tenantScope: request.context.tenantScope } }; await this.security?.rbac.assertCan(subject, action, { type: 'credential', id, scope: subject.scope }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject }); return subject; }
}
function pathId(request: HttpRequest): string { const value = request.path.split('/').filter(Boolean).at(-2); if (!value) throw new AppError('VALIDATION_FAILED', '凭据 ID 不能为空'); return decodeURIComponent(value); }
function queryString(request: HttpRequest, name: string): string | undefined { const value = request.query[name]; return Array.isArray(value) ? value[0] : value; }
