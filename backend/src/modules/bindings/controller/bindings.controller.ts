import { AppError } from '../../../common/errors/app-error.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { CertificateBindingStatuses } from '../../../shared/enums/core.enums.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import { BindingsApplicationService } from '../application/bindings.application-service.js';
import { bindingsEnumValues } from '../domain/bindings.domain-service.js';
import type { CreateCertificateBindingDto, DetectBindingDriftDto, PatchCertificateBindingStatusDto } from '../dto/bindings.dto.js';

const tags = ['Bindings'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class BindingsController {
  private readonly service: BindingsApplicationService;

  constructor(assetsService: AssetsApplicationService, service?: BindingsApplicationService) {
    this.service = service ?? new BindingsApplicationService(assetsService.getRepository());
  }

  getApplicationService(): BindingsApplicationService {
    return this.service;
  }

  register(router: Router): void {
    router.get('/api/v1/certificate-bindings', '查询 CertificateBinding 列表', tags, (request) => this.listCertificateBindings(request));
    router.get('/api/v1/certificate-bindings/usage', '查询证书使用位置', tags, (request) => this.findCertificateBindingUsages(request));
    router.post('/api/v1/certificate-bindings', '创建 CertificateBinding', tags, (request) => this.createCertificateBinding(request));
    router.post('/api/v1/certificate-bindings/drift', '检测 CertificateBinding 漂移', tags, (request) => this.detectDrift(request));
    router.patch('/api/v1/certificate-bindings/status', '更新 CertificateBinding 状态', tags, (request) => this.patchCertificateBindingStatus(request));
  }

  private createCertificateBinding(request: HttpRequest) {
    const body = validateObject(request.body, {
      serviceInstanceId: { type: 'string', required: true },
      serviceEndpointId: { type: 'string' },
      domainName: { type: 'string' },
      bindingType: { type: 'string', required: true, enum: bindingsEnumValues.bindingTypes },
      certificateVersionId: { type: 'string' },
      observedFingerprintSha256: { type: 'string' },
      desiredFingerprintSha256: { type: 'string' },
      certPath: { type: 'string' },
      keyPath: { type: 'string' },
      chainPath: { type: 'string' },
      keystorePath: { type: 'string' },
      keystoreType: { type: 'string', enum: bindingsEnumValues.keystoreTypes },
      storeLocation: { type: 'string' },
      storeName: { type: 'string' },
      storeThumbprint: { type: 'string' },
      reloadCommand: { type: 'string' },
      verifyMethod: { type: 'string', required: true, enum: bindingsEnumValues.verifyMethods },
      lastVerifiedAt: { type: 'string' },
      lastDeployedAt: { type: 'string' },
      status: { type: 'string', enum: CertificateBindingStatuses },
      metadata: { type: 'object' },
    });
    return { statusCode: 201, body: this.service.createCertificateBinding(tenantId(request), body as unknown as CreateCertificateBindingDto) };
  }

  private listCertificateBindings(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['domainName', 'createdAt', 'updatedAt', 'status', 'bindingType', 'serviceInstanceId', 'hostId'],
      allowedFilterFields: [
        'id',
        'serviceInstanceId',
        'serviceEndpointId',
        'hostId',
        'domainName',
        'bindingType',
        'certificateVersionId',
        'observedFingerprintSha256',
        'desiredFingerprintSha256',
        'status',
      ],
    });
    return this.service.listCertificateBindings(tenantId(request), query);
  }

  private findCertificateBindingUsages(request: HttpRequest) {
    return this.service.findCertificateBindingUsages(tenantId(request), {
      certificateVersionId: optionalQueryString(request.query.certificateVersionId),
      fingerprint: optionalQueryString(request.query.fingerprint),
    });
  }

  private detectDrift(request: HttpRequest) {
    const body = validateObject(request.body, {
      localFingerprintSha256: { type: 'string' },
      remoteFingerprintSha256: { type: 'string' },
      desiredFingerprintSha256: { type: 'string' },
      reachable: { type: 'boolean' },
    });
    return this.service.detectDrift(body as unknown as DetectBindingDriftDto);
  }

  private patchCertificateBindingStatus(request: HttpRequest) {
    const body = validateObject(request.body, {
      bindingId: { type: 'string', required: true },
      status: { type: 'string', required: true, enum: CertificateBindingStatuses },
    });
    try {
      return this.service.patchCertificateBindingStatus(tenantId(request), body as unknown as PatchCertificateBindingStatusDto);
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidStateTransitionError') {
        throw new AppError('VALIDATION_FAILED', error.message);
      }
      throw error;
    }
  }
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function optionalQueryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getBindingsRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/certificate-bindings', operationId: 'listCertificateBindings', summary: '查询 CertificateBinding 列表', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/certificate-bindings/usage', operationId: 'findCertificateBindingUsages', summary: '查询证书使用位置', tags, responseSchema: arraySchema() },
    { method: 'POST', path: '/api/v1/certificate-bindings', operationId: 'createCertificateBinding', summary: '创建 CertificateBinding', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/certificate-bindings/drift', operationId: 'detectCertificateBindingDrift', summary: '检测 CertificateBinding 漂移', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/certificate-bindings/status', operationId: 'patchCertificateBindingStatus', summary: '更新 CertificateBinding 状态', tags, responseSchema: objectSchema() },
  ];
}

function objectSchema() {
  return { type: 'object', additionalProperties: true };
}

function pageSchema() {
  return {
    type: 'object',
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
      page: { type: 'number' },
      pageSize: { type: 'number' },
      total: { type: 'number' },
    },
  };
}

function arraySchema() {
  return { type: 'array', items: { type: 'object', additionalProperties: true } };
}
