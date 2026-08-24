import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { LicensingApplicationService } from '../application/licensing.application-service.js';
import type { ActivationResponse, LicenseGrant, RevocationList } from '../domain/licensing.types.js';

export class LicensingController {
  constructor(private readonly service: LicensingApplicationService) {}

  register(router: Router): void {
    router.get('/api/v1/licensing/status', '获取授权状态', ['Licensing'], (request) => this.requireAuth(request).then(() => this.service.getStatus(request.context.tenantId)));
    router.post('/api/v1/licensing/license/import', '导入许可证', ['Licensing'], (request) => this.importLicense(request));
    router.post('/api/v1/licensing/activation-requests', '创建激活请求', ['Licensing'], (request) => this.createActivationRequest(request));
    router.post('/api/v1/licensing/activation-responses/import', '导入激活响应', ['Licensing'], (request) => this.importActivationResponse(request));
    router.post('/api/v1/licensing/revocations/import', '导入撤销列表', ['Licensing'], (request) => this.importRevocationList(request));
  }

  private async importLicense(request: HttpRequest) {
    await this.requireAuth(request);
    const body = validateObject(request.body, {
      licenseGrant: { type: 'object', required: true },
      revocationList: { type: 'object' },
    });
    return this.service.importLicense(
      body.licenseGrant as unknown as LicenseGrant,
      body.revocationList as unknown as RevocationList | undefined,
      request.context.tenantId,
    );
  }

  private async createActivationRequest(request: HttpRequest) {
    await this.requireAuth(request);
    const body = validateObject(request.body, {
      kind: { type: 'string', required: true, enum: ['offline'] },
    });
    return {
      request: await this.service.createActivationRequest(),
    };
  }

  private async importActivationResponse(request: HttpRequest) {
    await this.requireAuth(request);
    const body = validateObject(request.body, {
      activationResponse: { type: 'object', required: true },
    });
    return this.service.importActivationResponse(body.activationResponse as unknown as ActivationResponse, request.context.tenantId);
  }

  private async importRevocationList(request: HttpRequest) {
    await this.requireAuth(request);
    const body = validateObject(request.body, {
      revocationList: { type: 'object', required: true },
    });
    await this.service.importRevocationList(body.revocationList as unknown as RevocationList);
    return this.service.getStatus(request.context.tenantId);
  }

  private async requireAuth(request: HttpRequest): Promise<void> {
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED');
  }
}

export function getLicensingRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/licensing/status', operationId: 'getLicensingStatus', summary: '获取授权状态', tags: ['Licensing'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/licensing/license/import', operationId: 'importLicense', summary: '导入许可证', tags: ['Licensing'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/licensing/activation-requests', operationId: 'createActivationRequest', summary: '创建离线激活请求', tags: ['Licensing'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/licensing/activation-responses/import', operationId: 'importActivationResponse', summary: '导入激活响应', tags: ['Licensing'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/licensing/revocations/import', operationId: 'importRevocationList', summary: '导入撤销列表', tags: ['Licensing'], responseSchema: { type: 'object', additionalProperties: true } },
  ];
}
