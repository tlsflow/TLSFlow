import { AppError } from '../../../common/errors/app-error.js';
import { parsePageQuery, withAuthorization, type PageQuery } from '../../../common/pagination/pagination.js';
import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { CertificateBindingStatuses } from '../../../shared/enums/core.enums.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { BindingDriftPersistenceDto } from '../../assets/dto/assets.dto.js';
import { BindingsApplicationService } from '../application/bindings.application-service.js';
import { bindingsEnumValues } from '../domain/bindings.domain-service.js';
import type { CreateCertificateBindingDto, DeleteCertificateBindingDto, DetectBindingDriftDto, PatchCertificateBindingStatusDto, UpdateCertificateBindingDto } from '../dto/bindings.dto.js';

const tags = ['Bindings'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class BindingsController {
  private readonly service: BindingsApplicationService;

  constructor(assetsService: AssetsApplicationService, service?: BindingsApplicationService, private readonly security?: SecurityServices) {
    this.service = service ?? new BindingsApplicationService(assetsService.getRepository(), undefined, undefined, assetsService);
  }

  getApplicationService(): BindingsApplicationService {
    return this.service;
  }

  register(router: Router): void {
    router.get('/api/v1/certificate-bindings', '查询 CertificateBinding 列表', tags, (request) => this.listCertificateBindings(request));
    router.get('/api/v1/certificate-bindings/usage', '查询证书使用位置', tags, (request) => this.findCertificateBindingUsages(request));
    router.post('/api/v1/certificate-bindings', '创建 CertificateBinding', tags, (request) => this.createCertificateBinding(request));
    router.patch('/api/v1/certificate-bindings', '更新 CertificateBinding', tags, (request) => this.updateCertificateBinding(request));
    router.post('/api/v1/certificate-bindings/delete', '软删除 CertificateBinding', tags, (request) => this.deleteCertificateBinding(request));
    router.post('/api/v1/certificate-bindings/drift', '检测 CertificateBinding 漂移', tags, (request) => this.detectDrift(request));
    router.post('/api/v1/certificate-bindings/drift-results', '保存 CertificateBinding 漂移结果', tags, (request) => this.persistDrift(request));
    router.patch('/api/v1/certificate-bindings/status', '更新 CertificateBinding 状态', tags, (request) => this.patchCertificateBindingStatus(request));
  }

  private async createCertificateBinding(request: HttpRequest) {
    const body = validateObject(request.body, {
      serviceAssetId: { type: 'string' },
      siteAssetId: { type: 'string' },
      managedTargetId: { type: 'string' },
      serviceInstanceId: { type: 'string', required: true },
      serviceEndpointId: { type: 'string' },
      domainName: { type: 'string' },
      domain: { type: 'string' },
      port: { type: 'number' },
      protocol: { type: 'string' },
      bindingKey: { type: 'string' },
      bindingType: { type: 'string', required: true, enum: bindingsEnumValues.bindingTypes },
      certificateVersionId: { type: 'string' },
      targetCertificateVersionId: { type: 'string' },
      localCertificateVersionId: { type: 'string' },
      observedFingerprintSha256: { type: 'string' },
      desiredFingerprintSha256: { type: 'string' },
      targetFingerprintSha256: { type: 'string' },
      unmanagedCertificateFingerprint: { type: 'string' },
      certPath: { type: 'string' },
      keyPath: { type: 'string' },
      chainPath: { type: 'string' },
      keystorePath: { type: 'string' },
      keystoreType: { type: 'string', enum: bindingsEnumValues.keystoreTypes },
      storeLocation: { type: 'string' },
      storeName: { type: 'string' },
      storeThumbprint: { type: 'string' },
      reloadCommand: { type: 'string' },
      reloadHint: { type: 'object' },
      discoverySource: { type: 'string' },
      verifyMethod: { type: 'string', required: true, enum: bindingsEnumValues.verifyMethods },
      lastVerifiedAt: { type: 'string' },
      lastDeployedAt: { type: 'string' },
      status: { type: 'string', enum: CertificateBindingStatuses },
      metadata: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.manage', 'certificate_binding', request);
    return this.service.createCertificateBinding(tenantId(request), body as unknown as CreateCertificateBindingDto).then((created) => {
      this.audit(request, subject, 'certificate_binding.created', 'binding.manage', 'certificate_binding', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listCertificateBindings(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['domainName', 'domain', 'port', 'protocol', 'bindingKey', 'createdAt', 'updatedAt', 'lastVerifiedAt', 'status', 'bindingType', 'serviceInstanceId', 'hostId'],
      allowedFilterFields: [
        'id',
        'serviceAssetId',
        'siteAssetId',
        'managedTargetId',
        'serviceInstanceId',
        'serviceEndpointId',
        'hostId',
        'domainName',
        'domain',
        'port',
        'protocol',
        'bindingKey',
        'bindingType',
        'certificateVersionId',
        'observedFingerprintSha256',
        'desiredFingerprintSha256',
        'targetFingerprintSha256',
        'localConfigFingerprint',
        'remoteEndpointFingerprint',
        'unmanagedCertificateFingerprint',
        'driftStatus',
        'discoverySource',
        'status',
      ],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.read', 'certificate_binding', request);
    return this.service.listCertificateBindings(tenantId(request), await this.authorizedQuery(subject, 'certificate_binding', 'read', query));
  }

  private async findCertificateBindingUsages(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.read', 'certificate_binding', request);
    return this.service.findCertificateBindingUsages(tenantId(request), {
      certificateVersionId: optionalQueryString(request.query.certificateVersionId),
      fingerprint: optionalQueryString(request.query.fingerprint),
    });
  }

  private async updateCertificateBinding(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      serviceAssetId: { type: 'string' },
      siteAssetId: { type: 'string' },
      managedTargetId: { type: 'string' },
      serviceInstanceId: { type: 'string' },
      serviceEndpointId: { type: 'string' },
      domainName: { type: 'string' },
      domain: { type: 'string' },
      port: { type: 'number' },
      protocol: { type: 'string' },
      bindingKey: { type: 'string' },
      bindingType: { type: 'string', enum: bindingsEnumValues.bindingTypes },
      certificateVersionId: { type: 'string' },
      targetCertificateVersionId: { type: 'string' },
      localCertificateVersionId: { type: 'string' },
      observedFingerprintSha256: { type: 'string' },
      desiredFingerprintSha256: { type: 'string' },
      targetFingerprintSha256: { type: 'string' },
      unmanagedCertificateFingerprint: { type: 'string' },
      certPath: { type: 'string' },
      keyPath: { type: 'string' },
      chainPath: { type: 'string' },
      keystorePath: { type: 'string' },
      keystoreType: { type: 'string', enum: bindingsEnumValues.keystoreTypes },
      storeLocation: { type: 'string' },
      storeName: { type: 'string' },
      storeThumbprint: { type: 'string' },
      reloadCommand: { type: 'string' },
      reloadHint: { type: 'object' },
      discoverySource: { type: 'string' },
      verifyMethod: { type: 'string', enum: bindingsEnumValues.verifyMethods },
      localConfigFingerprint: { type: 'string' },
      localConfigPath: { type: 'string' },
      remoteEndpointFingerprint: { type: 'string' },
      remoteStatus: { type: 'string' },
      tlsVersion: { type: 'string' },
      chainSummary: { type: 'object' },
      checkedAt: { type: 'string' },
      driftStatus: { type: 'string' },
      lastVerifiedAt: { type: 'string' },
      lastDeployedAt: { type: 'string' },
      status: { type: 'string', enum: CertificateBindingStatuses },
      metadata: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateCertificateBindingDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.manage', 'certificate_binding', request, id);
    return this.service.getRepository().getCertificateBinding(tenantId(request), id).then((before) =>
      this.service.updateCertificateBinding(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'certificate_binding.updated', 'binding.manage', 'certificate_binding', id, before, updated);
        return updated;
      }),
    );
  }

  private async deleteCertificateBinding(request: HttpRequest) {
    const body = validateObject(request.body, { bindingId: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.manage', 'certificate_binding', request, String(body.bindingId));
    return this.service.getRepository().getCertificateBinding(tenantId(request), String(body.bindingId)).then((before) =>
      this.service.deleteCertificateBinding(tenantId(request), body as unknown as DeleteCertificateBindingDto).then((deleted) => {
        this.audit(request, subject, 'certificate_binding.deleted', 'binding.manage', 'certificate_binding', String(body.bindingId), before, deleted);
        return deleted;
      }),
    );
  }

  private async detectDrift(request: HttpRequest) {
    const body = validateObject(request.body, {
      localFingerprintSha256: { type: 'string' },
      remoteFingerprintSha256: { type: 'string' },
      desiredFingerprintSha256: { type: 'string' },
      reachable: { type: 'boolean' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.read', 'certificate_binding', request);
    return this.service.detectDrift(body as unknown as DetectBindingDriftDto);
  }

  private async persistDrift(request: HttpRequest) {
    const body = validateObject(request.body, {
      bindingId: { type: 'string', required: true },
      localConfigFingerprint: { type: 'string' },
      localConfigPath: { type: 'string' },
      remoteEndpointFingerprint: { type: 'string' },
      remoteStatus: { type: 'string' },
      tlsVersion: { type: 'string' },
      chainSummary: { type: 'object' },
      checkedAt: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.manage', 'certificate_binding', request, String(body.bindingId));
    return this.service.getRepository().getCertificateBinding(tenantId(request), String(body.bindingId)).then((before) =>
      this.service.persistDrift(tenantId(request), body as unknown as BindingDriftPersistenceDto).then((result) => {
        this.audit(request, subject, 'certificate_binding.drift_persisted', 'binding.manage', 'certificate_binding', String(body.bindingId), before, result.binding);
        return result;
      }),
    );
  }

  private async patchCertificateBindingStatus(request: HttpRequest) {
    const body = validateObject(request.body, {
      bindingId: { type: 'string', required: true },
      status: { type: 'string', required: true, enum: CertificateBindingStatuses },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'binding.manage', 'certificate_binding', request, String(body.bindingId));
    return this.service.getRepository().getCertificateBinding(tenantId(request), String(body.bindingId)).then((before) =>
      this.service.patchCertificateBindingStatus(tenantId(request), body as unknown as PatchCertificateBindingStatusDto).then((updated) => {
        this.audit(request, subject, 'certificate_binding.status_updated', 'binding.manage', 'certificate_binding', String(body.bindingId), before, updated);
        return updated;
      }).catch((error) => {
        if (error instanceof Error && error.name === 'InvalidStateTransitionError') {
          throw new AppError('VALIDATION_FAILED', error.message);
        }
        throw error;
      }),
    );
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_bindings', type: 'system', scope: { tenantId: request.context.tenantId } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }

  private async assertCan(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest, resourceId?: string): Promise<void> {
    if (!this.security) return;
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      id: resourceId,
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private async authorizedQuery(subject: SecuritySubject, objectType: string, accessLevel: 'read' | 'edit' | 'control', query: PageQuery): Promise<PageQuery> {
    if (!this.security) return query;
    return withAuthorization(query, await this.security.objectPermissions.buildAuthorizedQuery(subject, objectType, accessLevel));
  }

  private audit(request: HttpRequest, subject: SecuritySubject, eventType: string, action: string, resourceType: string, resourceId: string | undefined, before: unknown, after: unknown): void {
    void this.security?.audit.write({
      eventType,
      actorType: subject.type === 'system' ? 'system' : 'user',
      actorId: subject.id,
      action,
      resourceType,
      resourceId,
      result: 'success',
      riskLevel: 'low',
      context: this.securityContext(request, subject),
      detail: { before, after },
    }).catch(() => undefined);
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return { requestId: request.context.requestId, sourceIp: request.context.ip, actor };
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
    { method: 'PATCH', path: '/api/v1/certificate-bindings', operationId: 'updateCertificateBinding', summary: '更新 CertificateBinding', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/certificate-bindings/delete', operationId: 'deleteCertificateBinding', summary: '软删除 CertificateBinding', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/certificate-bindings/drift', operationId: 'detectCertificateBindingDrift', summary: '检测 CertificateBinding 漂移', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/certificate-bindings/drift-results', operationId: 'persistCertificateBindingDrift', summary: '保存 CertificateBinding 漂移结果', tags, responseSchema: objectSchema() },
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
