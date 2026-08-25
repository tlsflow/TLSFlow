import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { Router } from '../../../common/http/router.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { CredentialHealthService } from './credential-health.service.js';

export class CredentialHealthController {
  constructor(private readonly service: CredentialHealthService, private readonly security?: SecurityServices) {}
  register(router: Router): void {
    router.get('/api/v1/credentials/:id/health', '查询凭据有效性状态', ['Credentials'], (request) => this.health(request));
    router.get('/api/v1/credentials/:id/health-checks', '查询凭据有效性检测详情', ['Credentials'], (request) => this.checks(request));
    router.post('/api/v1/credentials/:id/health-check', '手动检测凭据有效性', ['Credentials'], (request) => this.manual(request));
  }
  private async health(request: HttpRequest) { const id = pathId(request); await this.authorize(request, 'credential.read', id); return this.service.getHealth(requireTenantId(request), id); }
  private async checks(request: HttpRequest) { const id = pathId(request); await this.authorize(request, 'credential.read', id); return { items: await this.service.listChecks(requireTenantId(request), id, queryString(request, 'deviceAssetId')) }; }
  private async manual(request: HttpRequest) { const id = pathId(request); const subject = await this.authorize(request, 'credential.health-check', id); const body = validateObject(request.body ?? {}, { deviceAssetId: { type: 'string' } }); const result = await this.service.enqueueManual(requireTenantId(request), id, subject.id, typeof body.deviceAssetId === 'string' ? body.deviceAssetId : undefined); return { statusCode: 202, body: { taskId: result.task.id, health: result.health } }; }
  private async authorize(request: HttpRequest, action: string, id: string): Promise<SecuritySubject> { const subject = { id: request.context.actorId ?? 'system_credentials', type: request.context.actorId ? 'user' as const : 'system' as const, scope: { tenantId: requireTenantId(request), tenantScope: request.context.tenantScope } }; await this.security?.rbac.assertCan(subject, action, { type: 'credential', id, scope: subject.scope }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject }); return subject; }
}
function pathId(request: HttpRequest): string { const value = request.path.split('/').filter(Boolean).at(-2); if (!value) throw new AppError('VALIDATION_FAILED', '凭据 ID 不能为空'); return decodeURIComponent(value); }
function queryString(request: HttpRequest, name: string): string | undefined { const value = request.query[name]; return Array.isArray(value) ? value[0] : value; }
