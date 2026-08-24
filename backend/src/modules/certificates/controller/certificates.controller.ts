import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { certificateFormats, certificateSourceTypes } from '../schema/certificates.schema.js';
import { CertificatesApplicationService } from '../application/certificates.application-service.js';
import type { BindingsApplicationService } from '../../bindings/application/bindings.application-service.js';

export interface CertificateServices {
  certificates: CertificatesApplicationService;
  bindings?: BindingsApplicationService;
}

export function createCertificateServices(security: SecurityServices): CertificateServices {
  return { certificates: new CertificatesApplicationService({ secrets: security.secrets, audit: security.audit }) };
}

export class CertificatesController {
  constructor(private readonly security: SecurityServices, private readonly services: CertificateServices = createCertificateServices(security)) {}

  register(router: Router): void {
    router.get('/api/v1/certificate-assets', '查询证书资产列表', ['Certificates'], (request) => this.listAssets(request));
    router.get('/api/v1/certificate-formats/capabilities', '查询证书格式能力', ['Certificates'], (request) => this.getFormatCapabilities(request));
    router.post('/api/v1/certificate-assets', '创建证书资产', ['Certificates'], (request) => this.createAsset(request));
    router.get('/api/v1/certificate-assets/detail', '查询证书资产详情', ['Certificates'], (request) => this.getAssetDetail(request));
    router.get('/api/v1/certificate-assets/:id', '查询证书资产详情', ['Certificates'], (request) => this.getAssetDetail(request));
    router.get('/api/v1/certificate-assets/:id/usage', '查询证书资产使用位置', ['Certificates'], (request) => this.getAssetUsage(request));
    router.post('/api/v1/certificate-assets/archive', '归档证书资产', ['Certificates'], (request) => this.archiveAsset(request));
    router.delete('/api/v1/certificate-assets/delete', '删除证书资产', ['Certificates'], (request) => this.deleteAsset(request));
    router.get('/api/v1/certificate-versions', '查询证书版本列表', ['Certificates'], (request) => this.listVersions(request));
    router.get('/api/v1/certificate-versions/detail', '查询证书版本详情', ['Certificates'], (request) => this.getVersionDetail(request));
    router.get('/api/v1/certificate-versions/usage', '查询证书版本使用位置', ['Certificates'], (request) => this.getVersionUsage(request));
    router.get('/api/v1/certificate-versions/:id/formats', '查询证书版本格式产物', ['Certificates'], (request) => this.getVersionFormats(request));
    router.post('/api/v1/certificate-versions/archive', '归档证书版本', ['Certificates'], (request) => this.archiveVersion(request));
    router.post('/api/v1/certificate-versions/revoke', '吊销证书版本', ['Certificates'], (request) => this.revokeVersion(request));
    router.delete('/api/v1/certificate-versions/delete', '删除证书版本', ['Certificates'], (request) => this.deleteVersion(request));
    router.post('/api/v1/certificate-versions/import', '导入证书版本', ['Certificates'], (request) => this.importVersion(request));
    router.get('/api/v1/certificate-version-formats', '查询证书格式产物列表', ['Certificates'], (request) => this.listFormats(request));
    router.post('/api/v1/certificate-version-formats', '创建证书格式产物记录', ['Certificates'], (request) => this.createFormat(request));
    router.post('/api/v1/certificate-version-formats/export-plan', '规划证书格式导出', ['Certificates'], (request) => this.requestFormatExport(request));
    router.post('/api/v1/certificate-sources/mock-sync', 'Mock 来源同步证书', ['Certificates'], (request) => this.syncFromSource(request));
  }

  private getFormatCapabilities(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version_format', request);
    return this.services.certificates.getFormatCapabilities();
  }

  private listAssets(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_asset', request);
    return this.services.certificates.listAssets(parsePageQuery(request.query, {
      allowedSortFields: ['name', 'primaryDomain', 'sourceType', 'status', 'createdAt', 'updatedAt'],
      allowedFilterFields: ['name', 'primaryDomain', 'sourceType', 'status', 'tags'],
    }));
  }

  private getAssetDetail(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_asset', request);
    return this.services.certificates.getAssetDetail(readRequiredId(request));
  }

  private getAssetUsage(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_asset', request);
    const assetId = readRequiredId(request);
    const usages = this.findUsages(request, { certificateAssetId: assetId });
    return { items: usages, total: usages.length, blockedDeletion: usages.length > 0 };
  }

  private archiveAsset(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.lifecycle', 'certificate_asset', request);
    return this.services.certificates.archiveAsset({ id: readRequiredId(request), status: 'archived', actorId: subject.id }, this.securityContext(request, subject));
  }

  private deleteAsset(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.lifecycle', 'certificate_asset', request);
    const usages = this.findUsages(request, { certificateAssetId: readRequiredId(request) });
    return this.services.certificates.deleteAsset({ id: readRequiredId(request), status: 'deleted', actorId: subject.id }, usages, this.securityContext(request, subject));
  }

  private createAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      primaryDomain: { type: 'string', required: true },
      sans: { type: 'array' },
      sourceType: { type: 'string', enum: certificateSourceTypes },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.create', 'certificate_asset', request);
    return {
      statusCode: 201,
      body: this.services.certificates.createAsset({
        name: String(body.name),
        primaryDomain: String(body.primaryDomain),
        sans: readStringArray(body.sans, 'sans'),
        sourceType: body.sourceType as any,
        tags: readStringArray(body.tags, 'tags'),
        createdBy: subject.id,
      }),
    };
  }

  private listVersions(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version', request);
    return this.services.certificates.listVersions(parsePageQuery(request.query, {
      allowedSortFields: ['certificateAssetId', 'versionNo', 'commonName', 'fingerprintSha256', 'serialNumber', 'notBefore', 'notAfter', 'status', 'createdAt'],
      allowedFilterFields: ['certificateAssetId', 'primaryDomain', 'commonName', 'sans', 'san', 'fingerprintSha256', 'fingerprint', 'serialNumber', 'notAfter', 'status', 'sourceType', 'chainStatus'],
    }));
  }

  private getVersionDetail(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version', request);
    return this.services.certificates.getVersionDetail(readRequiredId(request));
  }

  private getVersionUsage(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version', request);
    const version = this.services.certificates.getVersionDetail(readRequiredId(request));
    return this.services.certificates.getUsage({ certificateVersionId: version.id, fingerprintSha256: version.fingerprintSha256 }, this.findUsages(request, { certificateVersionId: version.id, fingerprintSha256: version.fingerprintSha256 }));
  }

  private getVersionFormats(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version_format', request);
    const versionId = readRequiredId(request);
    return this.services.certificates.listFormats({ page: 1, pageSize: 100, filter: { certificateVersionId: versionId } });
  }

  private archiveVersion(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.lifecycle', 'certificate_version', request);
    return this.services.certificates.archiveVersion({ id: readRequiredId(request), status: 'archived', actorId: subject.id }, this.securityContext(request, subject));
  }

  private revokeVersion(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.lifecycle', 'certificate_version', request);
    return this.services.certificates.revokeVersion({ id: readRequiredId(request), status: 'revoked', actorId: subject.id }, this.securityContext(request, subject));
  }

  private deleteVersion(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.lifecycle', 'certificate_version', request);
    const version = this.services.certificates.getVersionDetail(readRequiredId(request));
    const usages = this.findUsages(request, { certificateVersionId: version.id, fingerprintSha256: version.fingerprintSha256 });
    return this.services.certificates.deleteVersion({ id: version.id, status: 'deleted', actorId: subject.id }, usages, this.securityContext(request, subject));
  }

  private importVersion(request: HttpRequest) {
    const body = validateObject(request.body, {
      certificateAssetId: { type: 'string' },
      certificatePem: { type: 'string' },
      certificateDerBase64: { type: 'string' },
      privateKeyPem: { type: 'string' },
      pfxBase64: { type: 'string' },
      pfxPassword: { type: 'string' },
      jksBase64: { type: 'string' },
      p7bBase64: { type: 'string' },
      declaredFormat: { type: 'string', enum: certificateFormats },
      sourceType: { type: 'string', enum: certificateSourceTypes },
      name: { type: 'string' },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.import', 'certificate_version', request);
    return {
      statusCode: 201,
      body: this.services.certificates.importVersion({
        certificateAssetId: body.certificateAssetId === undefined ? undefined : String(body.certificateAssetId),
        certificatePem: body.certificatePem === undefined ? undefined : String(body.certificatePem),
        certificateDerBase64: body.certificateDerBase64 === undefined ? undefined : String(body.certificateDerBase64),
        privateKeyPem: body.privateKeyPem === undefined ? undefined : String(body.privateKeyPem),
        pfxBase64: body.pfxBase64 === undefined ? undefined : String(body.pfxBase64),
        pfxPassword: body.pfxPassword === undefined ? undefined : String(body.pfxPassword),
        jksBase64: body.jksBase64 === undefined ? undefined : String(body.jksBase64),
        p7bBase64: body.p7bBase64 === undefined ? undefined : String(body.p7bBase64),
        declaredFormat: body.declaredFormat as any,
        sourceType: body.sourceType as any,
        name: body.name === undefined ? undefined : String(body.name),
        tags: readStringArray(body.tags, 'tags'),
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
  }

  private listFormats(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.read', 'certificate_version_format', request);
    return this.services.certificates.listFormats(parsePageQuery(request.query, {
      allowedSortFields: ['certificateVersionId', 'format', 'createdAt', 'expiresAt'],
      allowedFilterFields: ['certificateVersionId', 'format', 'containsPrivateKey'],
    }));
  }

  private createFormat(request: HttpRequest) {
    const body = validateObject(request.body, {
      certificateVersionId: { type: 'string', required: true },
      format: { type: 'string', required: true, enum: certificateFormats },
      artifactRef: { type: 'string', required: true },
      containsPrivateKey: { type: 'boolean' },
      passwordSecretRef: { type: 'string' },
      parameters: { type: 'object' },
      expiresAt: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.format.create', 'certificate_version_format', request);
    return {
      statusCode: 201,
      body: this.services.certificates.createFormat({
        certificateVersionId: String(body.certificateVersionId),
        format: body.format as any,
        artifactRef: String(body.artifactRef),
        containsPrivateKey: body.containsPrivateKey === undefined ? undefined : Boolean(body.containsPrivateKey),
        passwordSecretRef: body.passwordSecretRef === undefined ? undefined : String(body.passwordSecretRef),
        parameters: body.parameters as Record<string, unknown> | undefined,
        createdBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
      }),
    };
  }

  private requestFormatExport(request: HttpRequest) {
    const body = validateObject(request.body, {
      certificateVersionId: { type: 'string', required: true },
      format: { type: 'string', required: true, enum: certificateFormats },
      containsPrivateKey: { type: 'boolean' },
      passwordSecretRef: { type: 'string' },
      parameters: { type: 'object' },
      expiresAt: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.format.create', 'certificate_version_format', request);
    return {
      statusCode: 201,
      body: this.services.certificates.requestFormatExport({
        certificateVersionId: String(body.certificateVersionId),
        format: body.format as any,
        containsPrivateKey: body.containsPrivateKey === undefined ? undefined : Boolean(body.containsPrivateKey),
        passwordSecretRef: body.passwordSecretRef === undefined ? undefined : String(body.passwordSecretRef),
        parameters: body.parameters as Record<string, unknown> | undefined,
        createdBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
      }, this.securityContext(request, subject)),
    };
  }

  private syncFromSource(request: HttpRequest) {
    const body = validateObject(request.body, {
      sourceType: { type: 'string', required: true, enum: certificateSourceTypes },
      externalId: { type: 'string', required: true },
      certificatePem: { type: 'string' },
      certificateDerBase64: { type: 'string' },
      privateKeyPem: { type: 'string' },
      pfxBase64: { type: 'string' },
      pfxPassword: { type: 'string' },
      jksBase64: { type: 'string' },
      p7bBase64: { type: 'string' },
      declaredFormat: { type: 'string', enum: certificateFormats },
      name: { type: 'string' },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.import', 'certificate_version', request);
    return {
      statusCode: 201,
      body: this.services.certificates.syncFromSource({
        sourceType: body.sourceType as any,
        externalId: String(body.externalId),
        certificatePem: body.certificatePem === undefined ? undefined : String(body.certificatePem),
        certificateDerBase64: body.certificateDerBase64 === undefined ? undefined : String(body.certificateDerBase64),
        privateKeyPem: body.privateKeyPem === undefined ? undefined : String(body.privateKeyPem),
        pfxBase64: body.pfxBase64 === undefined ? undefined : String(body.pfxBase64),
        pfxPassword: body.pfxPassword === undefined ? undefined : String(body.pfxPassword),
        jksBase64: body.jksBase64 === undefined ? undefined : String(body.jksBase64),
        p7bBase64: body.p7bBase64 === undefined ? undefined : String(body.p7bBase64),
        declaredFormat: body.declaredFormat as any,
        name: body.name === undefined ? undefined : String(body.name),
        tags: readStringArray(body.tags, 'tags'),
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
  }

  private findUsages(request: HttpRequest, query: { certificateAssetId?: string; certificateVersionId?: string; fingerprintSha256?: string }): unknown[] {
    if (!this.services.bindings) return [];
    if (query.certificateAssetId) {
      const detail = this.services.certificates.getAssetDetail(query.certificateAssetId);
      return detail.versions.flatMap((version) => this.services.bindings!.findCertificateBindingUsages(request.context.tenantId ?? '', { certificateVersionId: version.id, fingerprint: version.fingerprintSha256 }));
    }
    return this.services.bindings.findCertificateBindingUsages(request.context.tenantId ?? '', { certificateVersionId: query.certificateVersionId, fingerprint: query.fingerprintSha256 });
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!request.context.actorId) {
      throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    }
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }

  private assertCan(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest): void {
    this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private assertCanAny(subject: SecuritySubject, actions: string[], resourceType: string, request: HttpRequest): void {
    let lastError: unknown;
    for (const action of actions) {
      try {
        this.assertCan(subject, action, resourceType, request);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor,
    };
  }
}

function readStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是字符串数组`, { field });
  }
  return value;
}

const certificateAssetSchema = {
  type: 'object',
  additionalProperties: true,
};

const certificateVersionSchema = {
  type: 'object',
  additionalProperties: true,
};

const certificateVersionFormatSchema = {
  type: 'object',
  additionalProperties: true,
};

const pageSchema = {
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    total: { type: 'number' },
  },
};

const importCertificateVersionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    certificateAssetId: { type: 'string' },
    certificatePem: { type: 'string' },
    certificateDerBase64: { type: 'string' },
    privateKeyPem: { type: 'string', writeOnly: true, 'x-sensitive': true },
    pfxBase64: { type: 'string', writeOnly: true, 'x-sensitive': true },
    pfxPassword: { type: 'string', writeOnly: true, 'x-sensitive': true },
    jksBase64: { type: 'string', writeOnly: true, 'x-sensitive': true },
    p7bBase64: { type: 'string' },
    declaredFormat: { type: 'string', enum: [...certificateFormats] },
    sourceType: { type: 'string', enum: [...certificateSourceTypes] },
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

export function getCertificateRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/certificate-formats/capabilities', operationId: 'getCertificateFormatCapabilities', summary: '查询证书格式能力', tags: ['Certificates'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/certificate-assets', operationId: 'listCertificateAssets', summary: '查询证书资产列表', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-assets', operationId: 'createCertificateAsset', summary: '创建证书资产', tags: ['Certificates'], responseSchema: certificateAssetSchema },
    { method: 'GET', path: '/api/v1/certificate-assets/detail', operationId: 'getCertificateAssetDetail', summary: '查询证书资产详情', tags: ['Certificates'], responseSchema: certificateAssetSchema },
    { method: 'GET', path: '/api/v1/certificate-assets/:id', operationId: 'getCertificateAssetDetailById', summary: '按 ID 查询证书资产详情', tags: ['Certificates'], responseSchema: certificateAssetSchema },
    { method: 'GET', path: '/api/v1/certificate-assets/:id/usage', operationId: 'getCertificateAssetUsageById', summary: '按 ID 查询证书资产使用位置', tags: ['Certificates'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/certificate-assets/archive', operationId: 'archiveCertificateAsset', summary: '归档证书资产', tags: ['Certificates'], responseSchema: certificateAssetSchema },
    { method: 'DELETE', path: '/api/v1/certificate-assets/delete', operationId: 'deleteCertificateAsset', summary: '删除证书资产', tags: ['Certificates'], responseSchema: certificateAssetSchema },
    { method: 'GET', path: '/api/v1/certificate-versions', operationId: 'listCertificateVersions', summary: '查询证书版本列表', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'GET', path: '/api/v1/certificate-versions/detail', operationId: 'getCertificateVersionDetail', summary: '查询证书版本详情', tags: ['Certificates'], responseSchema: certificateVersionSchema },
    { method: 'GET', path: '/api/v1/certificate-versions/usage', operationId: 'getCertificateVersionUsage', summary: '查询证书版本使用位置', tags: ['Certificates'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/certificate-versions/:id/formats', operationId: 'listCertificateVersionFormatsByVersionId', summary: '按版本查询证书格式产物', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/archive', operationId: 'archiveCertificateVersion', summary: '归档证书版本', tags: ['Certificates'], responseSchema: certificateVersionSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/revoke', operationId: 'revokeCertificateVersion', summary: '吊销证书版本', tags: ['Certificates'], responseSchema: certificateVersionSchema },
    { method: 'DELETE', path: '/api/v1/certificate-versions/delete', operationId: 'deleteCertificateVersion', summary: '删除证书版本', tags: ['Certificates'], responseSchema: certificateVersionSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/import', operationId: 'importCertificateVersion', summary: '导入证书版本', tags: ['Certificates'], requestSchema: importCertificateVersionRequestSchema, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/certificate-version-formats', operationId: 'listCertificateVersionFormats', summary: '查询证书格式产物列表', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats', operationId: 'createCertificateVersionFormat', summary: '创建证书格式产物记录', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats/export-plan', operationId: 'requestCertificateFormatExport', summary: '规划证书格式导出', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'POST', path: '/api/v1/certificate-sources/mock-sync', operationId: 'mockSyncCertificateSource', summary: 'Mock 来源同步证书', tags: ['Certificates'], responseSchema: { type: 'object', additionalProperties: true } },
  ];
}

function readRequiredId(request: HttpRequest): string {
  const bodyId = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>).id : undefined;
  const pathId = request.path.match(/^\/api\/v1\/certificate-(?:assets|versions)\/([^/]+)/)?.[1];
  const id = bodyId ?? request.query.id ?? pathId;
  if (Array.isArray(id) || typeof id !== 'string' || id.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'id 不能为空', { field: 'id' });
  }
  return id;
}
