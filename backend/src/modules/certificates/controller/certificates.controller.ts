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

export interface CertificateServices {
  certificates: CertificatesApplicationService;
}

export function createCertificateServices(security: SecurityServices): CertificateServices {
  return { certificates: new CertificatesApplicationService({ secrets: security.secrets, audit: security.audit }) };
}

export class CertificatesController {
  constructor(private readonly security: SecurityServices, private readonly services: CertificateServices = createCertificateServices(security)) {}

  register(router: Router): void {
    router.get('/api/v1/certificate-assets', '查询证书资产列表', ['Certificates'], (request) => this.listAssets(request));
    router.post('/api/v1/certificate-assets', '创建证书资产', ['Certificates'], (request) => this.createAsset(request));
    router.get('/api/v1/certificate-versions', '查询证书版本列表', ['Certificates'], (request) => this.listVersions(request));
    router.post('/api/v1/certificate-versions/import', '导入证书版本', ['Certificates'], (request) => this.importVersion(request));
    router.get('/api/v1/certificate-version-formats', '查询证书格式产物列表', ['Certificates'], (request) => this.listFormats(request));
    router.post('/api/v1/certificate-version-formats', '创建证书格式产物记录', ['Certificates'], (request) => this.createFormat(request));
    router.post('/api/v1/certificate-version-formats/export-plan', '规划证书格式导出', ['Certificates'], (request) => this.requestFormatExport(request));
    router.post('/api/v1/certificate-sources/mock-sync', 'Mock 来源同步证书', ['Certificates'], (request) => this.syncFromSource(request));
  }

  private listAssets(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'certificate.read', 'certificate_asset', request);
    return this.services.certificates.listAssets(parsePageQuery(request.query, {
      allowedSortFields: ['name', 'primaryDomain', 'sourceType', 'status', 'createdAt', 'updatedAt'],
      allowedFilterFields: ['name', 'primaryDomain', 'sourceType', 'status', 'tags'],
    }));
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
    this.assertCan(subject, 'certificate.read', 'certificate_version', request);
    return this.services.certificates.listVersions(parsePageQuery(request.query, {
      allowedSortFields: ['certificateAssetId', 'versionNo', 'commonName', 'fingerprintSha256', 'serialNumber', 'notBefore', 'notAfter', 'status', 'createdAt'],
      allowedFilterFields: ['certificateAssetId', 'primaryDomain', 'commonName', 'sans', 'san', 'fingerprintSha256', 'fingerprint', 'serialNumber', 'notAfter', 'status', 'sourceType', 'chainStatus'],
    }));
  }

  private importVersion(request: HttpRequest) {
    const body = validateObject(request.body, {
      certificateAssetId: { type: 'string' },
      certificatePem: { type: 'string' },
      certificateDerBase64: { type: 'string' },
      privateKeyPem: { type: 'string' },
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
        name: body.name === undefined ? undefined : String(body.name),
        tags: readStringArray(body.tags, 'tags'),
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
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

export function getCertificateRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/certificate-assets', operationId: 'listCertificateAssets', summary: '查询证书资产列表', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-assets', operationId: 'createCertificateAsset', summary: '创建证书资产', tags: ['Certificates'], responseSchema: certificateAssetSchema },
    { method: 'GET', path: '/api/v1/certificate-versions', operationId: 'listCertificateVersions', summary: '查询证书版本列表', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/import', operationId: 'importCertificateVersion', summary: '导入证书版本', tags: ['Certificates'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/certificate-version-formats', operationId: 'listCertificateVersionFormats', summary: '查询证书格式产物列表', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats', operationId: 'createCertificateVersionFormat', summary: '创建证书格式产物记录', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats/export-plan', operationId: 'requestCertificateFormatExport', summary: '规划证书格式导出', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'POST', path: '/api/v1/certificate-sources/mock-sync', operationId: 'mockSyncCertificateSource', summary: 'Mock 来源同步证书', tags: ['Certificates'], responseSchema: { type: 'object', additionalProperties: true } },
  ];
}
