import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import { parsePageQuery, withAuthorization, type PageQuery } from '../../../common/pagination/pagination.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { certificateFormats, certificateSourceTypes } from '../schema/certificates.schema.js';
import { CertificatesApplicationService } from '../application/certificates.application-service.js';
import type { BindingsApplicationService } from '../../bindings/application/bindings.application-service.js';

export interface CertificateServices {
  certificates: CertificatesApplicationService;
  bindings?: BindingsApplicationService;
}

export interface CreateCertificateServicesOptions {
  db?: DatabasePort;
}

export function createCertificateServices(security: SecurityServices, options: CreateCertificateServicesOptions = {}): CertificateServices {
  return { certificates: new CertificatesApplicationService({ db: options.db, secrets: security.secrets, audit: security.audit }) };
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
    router.post('/api/v1/certificate-versions/import', 'Import certificate material', ['Certificates'], (request) => this.importVersion(request));
    router.post('/api/v1/certificate-versions/validate-import', '校验证书导入材料', ['Certificates'], (request) => this.validateImportVersion(request));
    router.get('/api/v1/certificate-version-formats', '查询证书格式产物列表', ['Certificates'], (request) => this.listFormats(request));
    router.post('/api/v1/certificate-version-formats/export-plan', '规划证书格式导出', ['Certificates'], (request) => this.planFormatExport(request));
    router.post('/api/v1/certificate-version-formats/export', '生成证书格式导出产物', ['Certificates'], (request) => this.exportFormatArtifact(request));
    router.post('/api/v1/certificate-version-formats', '创建证书格式产物记录', ['Certificates'], (request) => this.createFormat(request));
    router.patch('/api/v1/certificate-version-formats', '更新证书格式产物记录', ['Certificates'], (request) => this.updateFormat(request));
    router.post('/api/v1/certificate-version-formats/delete', '删除证书格式产物记录', ['Certificates'], (request) => this.deleteFormat(request));
    router.post('/api/v1/certificate-sources/mock-sync', 'Mock 来源同步证书', ['Certificates'], (request) => this.syncFromSource(request));
  }

  private async getFormatCapabilities(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version_format', request);
    return this.services.certificates.getFormatCapabilities();
  }

  private async listAssets(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['name', 'primaryDomain', 'sourceType', 'status', 'createdAt', 'updatedAt'],
      allowedFilterFields: ['name', 'primaryDomain', 'sourceType', 'status', 'tags'],
    });
    const authorized = await this.authorizedQuery(subject, 'certificate_asset', 'read', query);
    if (!hasAuthorizedReadScope(authorized.authorization) && !await this.canReadObject(subject, 'certificate_asset', request)) {
      await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_asset', request);
    }
    return this.services.certificates.listAssets(authorized, tenantId);
  }

  private async getAssetDetail(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    const assetId = readRequiredId(request);
    if (!await this.canReadObject(subject, 'certificate_asset', request, assetId, true)) {
      await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_asset', request);
    }
    return this.services.certificates.getAssetDetail(assetId, tenantId);
  }

  private async getAssetUsage(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    const assetId = readRequiredId(request);
    if (!await this.canReadObject(subject, 'certificate_asset', request, assetId, true)) {
      await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_asset', request);
    }
    const usages = await this.findUsages(request, { certificateAssetId: assetId });
    return { items: usages, total: usages.length, blockedDeletion: usages.length > 0 };
  }

  private async archiveAsset(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'certificate.lifecycle', 'certificate_asset', request);
    return this.services.certificates.archiveAsset({ id: readRequiredId(request), status: 'archived', actorId: subject.id, tenantId }, this.securityContext(request, subject));
  }

  private async deleteAsset(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'certificate.lifecycle', 'certificate_asset', request);
    const usages = await this.findUsages(request, { certificateAssetId: readRequiredId(request) });
    return this.services.certificates.deleteAsset({ id: readRequiredId(request), status: 'deleted', actorId: subject.id, tenantId }, usages, this.securityContext(request, subject));
  }

  private async createAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      primaryDomain: { type: 'string', required: true },
      sans: { type: 'array' },
      sourceType: { type: 'string', enum: certificateSourceTypes },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.create', 'certificate_asset', request);
    return {
      statusCode: 201,
      body: await this.services.certificates.createAsset({
        name: String(body.name),
        primaryDomain: String(body.primaryDomain),
        sans: readStringArray(body.sans, 'sans'),
        sourceType: body.sourceType as any,
        tags: readStringArray(body.tags, 'tags'),
        tenantId,
        createdBy: subject.id,
      }),
    };
  }

  private async listVersions(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['certificateAssetId', 'versionNo', 'commonName', 'fingerprintSha256', 'serialNumber', 'notBefore', 'notAfter', 'status', 'createdAt'],
      allowedFilterFields: ['certificateAssetId', 'primaryDomain', 'commonName', 'sans', 'san', 'fingerprintSha256', 'fingerprint', 'serialNumber', 'notAfter', 'status', 'sourceType', 'chainStatus'],
    });
    const certificateAssetId = query.filter.certificateAssetId;
    const authorized = await this.authorizedQuery(subject, 'certificate_version', 'read', query);
    const canReadAssetVersions = certificateAssetId
      ? await this.canReadObject(subject, 'certificate_asset', request, certificateAssetId, true)
      : false;
    if (!hasAuthorizedReadScope(authorized.authorization) && !canReadAssetVersions) {
      await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version', request);
      return this.services.certificates.listVersions(authorized, tenantId);
    }
    return this.services.certificates.listVersions(canReadAssetVersions ? query : authorized, tenantId);
  }

  private async getVersionDetail(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    const versionId = readRequiredId(request);
    const { version, allowed } = await this.resolveReadableVersion(subject, request, versionId, tenantId);
    if (!allowed) {
      await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version', request);
    }
    return version;
  }

  private async getVersionUsage(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    const versionId = readRequiredId(request);
    const { version, allowed } = await this.resolveReadableVersion(subject, request, versionId, tenantId);
    if (!allowed) {
      await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version', request);
    }
    const usageQuery = {
      certificateVersionId: version.id,
      fingerprintSha256: version.fingerprintSha256,
      domains: collectCertificateDomains(version),
    };
    return this.services.certificates.getUsage(
      usageQuery,
      await this.findUsages(request, usageQuery),
    );
  }

  private async getVersionFormats(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    await this.assertCanAny(subject, ['certificate.read', 'certificate.asset.read'], 'certificate_version_format', request);
    const versionId = readRequiredId(request);
    return this.services.certificates.listFormats(await this.authorizedQuery(subject, 'certificate_version_format', 'read', { page: 1, pageSize: 100, filter: { certificateVersionId: versionId } }), tenantId);
  }

  private async archiveVersion(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'certificate.lifecycle', 'certificate_version', request);
    return this.services.certificates.archiveVersion({ id: readRequiredId(request), status: 'archived', actorId: subject.id, tenantId }, this.securityContext(request, subject));
  }

  private async revokeVersion(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'certificate.lifecycle', 'certificate_version', request);
    return this.services.certificates.revokeVersion({ id: readRequiredId(request), status: 'revoked', actorId: subject.id, tenantId }, this.securityContext(request, subject));
  }

  private async deleteVersion(request: HttpRequest) {
    const tenantId = requireTenantId(request);
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'certificate.lifecycle', 'certificate_version', request);
    const version = await this.services.certificates.getVersionDetail(readRequiredId(request), tenantId);
    const usages = await this.findUsages(request, { certificateVersionId: version.id, fingerprintSha256: version.fingerprintSha256 });
    return this.services.certificates.deleteVersion({ id: version.id, status: 'deleted', actorId: subject.id, tenantId }, usages, this.securityContext(request, subject));
  }

  private async importVersion(request: HttpRequest) {
    const body = validateObject(request.body, {
      certificateAssetId: { type: 'string' },
      certificatePem: { type: 'string' },
      certificateDerBase64: { type: 'string' },
      privateKeyPem: { type: 'string' },
      pfxBase64: { type: 'string' },
      pfxPassword: { type: 'string' },
      jksBase64: { type: 'string' },
      jksPassword: { type: 'string' },
      jksKeyPassword: { type: 'string' },
      jksAlias: { type: 'string' },
      p7bBase64: { type: 'string' },
      allowCertificateOnly: { type: 'boolean' },
      declaredFormat: { type: 'string', enum: certificateFormats },
      sourceType: { type: 'string', enum: certificateSourceTypes },
      name: { type: 'string' },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.import', 'certificate_version', request);
    return {
      statusCode: 201,
      body: await this.services.certificates.importVersion({
        certificateAssetId: body.certificateAssetId === undefined ? undefined : String(body.certificateAssetId),
        certificatePem: body.certificatePem === undefined ? undefined : String(body.certificatePem),
        certificateDerBase64: body.certificateDerBase64 === undefined ? undefined : String(body.certificateDerBase64),
        privateKeyPem: body.privateKeyPem === undefined ? undefined : String(body.privateKeyPem),
        pfxBase64: body.pfxBase64 === undefined ? undefined : String(body.pfxBase64),
        pfxPassword: body.pfxPassword === undefined ? undefined : String(body.pfxPassword),
        jksBase64: body.jksBase64 === undefined ? undefined : String(body.jksBase64),
        jksPassword: body.jksPassword === undefined ? undefined : String(body.jksPassword),
        jksKeyPassword: body.jksKeyPassword === undefined ? undefined : String(body.jksKeyPassword),
        jksAlias: body.jksAlias === undefined ? undefined : String(body.jksAlias),
        p7bBase64: body.p7bBase64 === undefined ? undefined : String(body.p7bBase64),
        allowCertificateOnly: body.allowCertificateOnly === true,
        declaredFormat: body.declaredFormat as any,
        sourceType: body.sourceType as any,
        name: body.name === undefined ? undefined : String(body.name),
        tags: readStringArray(body.tags, 'tags'),
        tenantId,
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
  }

  private async validateImportVersion(request: HttpRequest) {
    const body = validateObject(request.body, {
      certificateAssetId: { type: 'string' },
      certificatePem: { type: 'string' },
      privateKeyPem: { type: 'string' },
      pfxBase64: { type: 'string' },
      pfxPassword: { type: 'string' },
      declaredFormat: { type: 'string', enum: certificateFormats },
      sourceType: { type: 'string', enum: certificateSourceTypes },
      name: { type: 'string' },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.import', 'certificate_version', request);
    return {
      statusCode: 200,
      body: this.services.certificates.validateImportVersion({
        certificateAssetId: body.certificateAssetId === undefined ? undefined : String(body.certificateAssetId),
        certificatePem: body.certificatePem === undefined ? undefined : String(body.certificatePem),
        privateKeyPem: body.privateKeyPem === undefined ? undefined : String(body.privateKeyPem),
        pfxBase64: body.pfxBase64 === undefined ? undefined : String(body.pfxBase64),
        pfxPassword: body.pfxPassword === undefined ? undefined : String(body.pfxPassword),
        declaredFormat: body.declaredFormat as any,
        sourceType: body.sourceType as any,
        name: body.name === undefined ? undefined : String(body.name),
        tags: readStringArray(body.tags, 'tags'),
        createdBy: subject.id,
      }),
    };
  }

  private async listFormats(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.read', 'certificate_version_format', request);
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['certificateVersionId', 'format', 'createdAt', 'expiresAt'],
      allowedFilterFields: ['certificateVersionId', 'format', 'containsPrivateKey'],
    });
    return this.services.certificates.listFormats(await this.authorizedQuery(subject, 'certificate_version_format', 'read', query), tenantId);
  }

  private async createFormat(request: HttpRequest) {
    const body = this.readFormatExportBody(request);
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.format.create', 'certificate_version_format', request);
    return {
      statusCode: 201,
      body: await this.services.certificates.createFormat({
        certificateVersionId: body.certificateVersionId === undefined ? undefined : String(body.certificateVersionId),
        format: body.format as any,
        containsPrivateKey: body.containsPrivateKey === undefined ? undefined : Boolean(body.containsPrivateKey),
        passwordSecretRef: body.passwordSecretRef === undefined ? undefined : String(body.passwordSecretRef),
        parameters: body.parameters as Record<string, unknown> | undefined,
        createdBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
        tenantId,
      }),
    };
  }

  private async planFormatExport(request: HttpRequest) {
    const body = this.readFormatExportBody(request);
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.format.create', 'certificate_version_format', request);
    return {
      statusCode: 201,
      body: await this.services.certificates.planFormatExport({
        certificateVersionId: body.certificateVersionId === undefined ? undefined : String(body.certificateVersionId),
        format: body.format as any,
        containsPrivateKey: body.containsPrivateKey === undefined ? undefined : Boolean(body.containsPrivateKey),
        passwordSecretRef: body.passwordSecretRef === undefined ? undefined : String(body.passwordSecretRef),
        parameters: body.parameters as Record<string, unknown> | undefined,
        createdBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
        tenantId,
      }, this.securityContext(request, subject)),
    };
  }

  private async exportFormatArtifact(request: HttpRequest) {
    const body = this.readFormatExportBody(request);
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.format.create', 'certificate_version_format', request);
    return {
      statusCode: 201,
      body: await this.services.certificates.exportFormatArtifact({
        certificateVersionId: body.certificateVersionId === undefined ? undefined : String(body.certificateVersionId),
        format: body.format as any,
        containsPrivateKey: body.containsPrivateKey === undefined ? undefined : Boolean(body.containsPrivateKey),
        passwordSecretRef: body.passwordSecretRef === undefined ? undefined : String(body.passwordSecretRef),
        parameters: body.parameters as Record<string, unknown> | undefined,
        createdBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
        tenantId,
      }, this.securityContext(request, subject)),
    };
  }

  private readFormatExportBody(request: HttpRequest): Record<string, unknown> {
    return validateObject(request.body, {
      certificateVersionId: { type: 'string' },
      format: { type: 'string', required: true, enum: certificateFormats },
      containsPrivateKey: { type: 'boolean' },
      passwordSecretRef: { type: 'string' },
      parameters: { type: 'object' },
      expiresAt: { type: 'string' },
    });
  }

  private async updateFormat(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      certificateVersionId: { type: 'string' },
      format: { type: 'string', enum: certificateFormats },
      containsPrivateKey: { type: 'boolean' },
      passwordSecretRef: { type: 'string' },
      parameters: { type: 'object' },
      expiresAt: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.format.create', 'certificate_version_format', request);
    return {
      statusCode: 200,
      body: await this.services.certificates.updateFormat({
        id: String(body.id),
        certificateVersionId: body.certificateVersionId === undefined ? undefined : String(body.certificateVersionId),
        format: body.format as any,
        containsPrivateKey: body.containsPrivateKey === undefined ? undefined : Boolean(body.containsPrivateKey),
        passwordSecretRef: body.passwordSecretRef === undefined ? undefined : String(body.passwordSecretRef),
        parameters: body.parameters as Record<string, unknown> | undefined,
        createdBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
        tenantId,
      }, this.securityContext(request, subject)),
    };
  }

  private async deleteFormat(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
    });
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.format.create', 'certificate_version_format', request);
    return {
      statusCode: 200,
      body: await this.services.certificates.deleteFormat({
        id: String(body.id),
        deletedBy: subject.id,
        tenantId,
      }, this.securityContext(request, subject)),
    };
  }

  private async syncFromSource(request: HttpRequest) {
    const body = validateObject(request.body, {
      sourceType: { type: 'string', required: true, enum: certificateSourceTypes },
      externalId: { type: 'string', required: true },
      certificatePem: { type: 'string' },
      privateKeyPem: { type: 'string' },
      pfxBase64: { type: 'string' },
      pfxPassword: { type: 'string' },
      declaredFormat: { type: 'string', enum: certificateFormats },
      name: { type: 'string' },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    const tenantId = requireTenantId(request);
    await this.assertCan(subject, 'certificate.import', 'certificate_version', request);
    return {
      statusCode: 201,
      body: await this.services.certificates.syncFromSource({
        sourceType: body.sourceType as any,
        externalId: String(body.externalId),
        certificatePem: body.certificatePem === undefined ? undefined : String(body.certificatePem),
        privateKeyPem: body.privateKeyPem === undefined ? undefined : String(body.privateKeyPem),
        pfxBase64: body.pfxBase64 === undefined ? undefined : String(body.pfxBase64),
        pfxPassword: body.pfxPassword === undefined ? undefined : String(body.pfxPassword),
        declaredFormat: body.declaredFormat as any,
        name: body.name === undefined ? undefined : String(body.name),
        tags: readStringArray(body.tags, 'tags'),
        tenantId,
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
  }

  private async findUsages(request: HttpRequest, query: { certificateAssetId?: string; certificateVersionId?: string; fingerprintSha256?: string; domains?: string[] }): Promise<unknown[]> {
    if (!this.services.bindings) return [];
    const tenantId = requireTenantId(request);
    if (query.certificateAssetId) {
      const detail = await this.services.certificates.getAssetDetail(query.certificateAssetId, tenantId);
      return detail.versions.flatMap((version) => this.services.bindings!.findCertificateBindingUsages(
        tenantId,
        { certificateVersionId: version.id, fingerprint: version.fingerprintSha256, domains: collectCertificateDomains(version) },
      ));
    }
    return this.services.bindings.findCertificateBindingUsages(tenantId, {
      certificateVersionId: query.certificateVersionId,
      fingerprint: query.fingerprintSha256,
      domains: query.domains,
    });
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!request.context.actorId) {
      throw new AppError('AUTH_UNAUTHENTICATED', 'Missing actor context');
    }
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private async assertCan(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest): Promise<void> {
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private async assertCanAny(subject: SecuritySubject, actions: string[], resourceType: string, request: HttpRequest): Promise<void> {
    let lastError: unknown;
    for (const action of actions) {
      try {
        await this.assertCan(subject, action, resourceType, request);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async authorizedQuery(subject: SecuritySubject, objectType: string, accessLevel: 'read' | 'edit' | 'control', query: PageQuery): Promise<PageQuery> {
    return withAuthorization(query, await this.security.objectPermissions.buildAuthorizedQuery(subject, objectType, accessLevel));
  }

  private async resolveReadableVersion(
    subject: SecuritySubject,
    request: HttpRequest,
    versionId: string,
    tenantId: string,
  ): Promise<{ version: Awaited<ReturnType<CertificatesApplicationService['getVersionDetail']>>; allowed: boolean }> {
    if (await this.canReadObject(subject, 'certificate_version', request, versionId, true)) {
      return {
        version: await this.services.certificates.getVersionDetail(versionId, tenantId),
        allowed: true,
      };
    }

    const version = await this.services.certificates.getVersionDetail(versionId, tenantId);
    const assetId = typeof version.asset?.id === 'string'
      ? version.asset.id
      : typeof version.certificateAssetId === 'string'
        ? version.certificateAssetId
        : undefined;
    if (assetId && await this.canReadObject(subject, 'certificate_asset', request, assetId, true)) {
      return { version, allowed: true };
    }
    return { version, allowed: false };
  }

  private async canReadObject(
    subject: SecuritySubject,
    objectType: string,
    request: HttpRequest,
    objectId?: string,
    requireObjectMatch = false,
  ): Promise<boolean> {
    const objectAllowed = objectId
      ? await this.security.objectPermissions.isAllowed(subject, 'read', {
        objectType,
        objectId,
        tenantId: request.context.tenantId,
      })
      : false;
    if (objectAllowed) return true;
    if (requireObjectMatch) return false;
    const action = objectType === 'certificate_asset' ? 'certificate.asset.read' : 'certificate.read';
    const decision = await this.security.rbac.can(subject, action, {
      type: objectType,
      id: objectId,
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, this.securityContext(request, subject));
    return decision.allowed;
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor,
    };
  }
}

function hasAuthorizedReadScope(authorization: PageQuery['authorization']): boolean {
  if (!authorization) return false;
  if (authorization.unrestricted) return true;
  if ((authorization.objectIds?.length ?? 0) > 0) return true;
  return (authorization.dynamicConditions?.length ?? 0) > 0;
}

function collectCertificateDomains(version: { commonName?: string; sans?: string[]; asset?: { primaryDomain?: string } }): string[] {
  const values = [
    version.commonName,
    ...(version.sans ?? []),
    version.asset?.primaryDomain,
  ];
  return [...new Set(values.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean))];
}

function readStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是字符串数组`, { field });
  }
  return value;
}

const certificateAssetSchema = { type: 'object', additionalProperties: true };
const certificateVersionSchema = { type: 'object', additionalProperties: true };
const certificateVersionFormatSchema = { type: 'object', additionalProperties: true };
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
    certificateDerBase64: { type: 'string', writeOnly: true, 'x-sensitive': true },
    privateKeyPem: { type: 'string', writeOnly: true, 'x-sensitive': true },
    pfxBase64: { type: 'string', writeOnly: true, 'x-sensitive': true },
    pfxPassword: { type: 'string', writeOnly: true, 'x-sensitive': true },
    jksBase64: { type: 'string', writeOnly: true, 'x-sensitive': true },
    jksPassword: { type: 'string', writeOnly: true, 'x-sensitive': true },
    jksKeyPassword: { type: 'string', writeOnly: true, 'x-sensitive': true },
    jksAlias: { type: 'string' },
    p7bBase64: { type: 'string', writeOnly: true, 'x-sensitive': true },
    allowCertificateOnly: { type: 'boolean' },
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
    { method: 'GET', path: '/api/v1/certificate-versions/:id/formats', operationId: 'listCertificateVersionFormatsByVersionId', summary: 'List certificate version formats by version id', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/import', operationId: 'importCertificateVersion', summary: 'Import certificate material', tags: ['Certificates'], requestSchema: importCertificateVersionRequestSchema, responseSchema: certificateVersionSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/archive', operationId: 'archiveCertificateVersion', summary: '归档证书版本', tags: ['Certificates'], responseSchema: certificateVersionSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/revoke', operationId: 'revokeCertificateVersion', summary: '吊销证书版本', tags: ['Certificates'], responseSchema: certificateVersionSchema },
    { method: 'DELETE', path: '/api/v1/certificate-versions/delete', operationId: 'deleteCertificateVersion', summary: '删除证书版本', tags: ['Certificates'], responseSchema: certificateVersionSchema },
    { method: 'POST', path: '/api/v1/certificate-versions/validate-import', operationId: 'validateImportCertificateVersion', summary: 'Validate certificate import material', tags: ['Certificates'], requestSchema: importCertificateVersionRequestSchema, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/certificate-version-formats', operationId: 'listCertificateVersionFormats', summary: '查询证书格式产物列表', tags: ['Certificates'], responseSchema: pageSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats/export-plan', operationId: 'planCertificateVersionFormatExport', summary: '规划证书格式导出', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats/export', operationId: 'exportCertificateVersionFormatArtifact', summary: '生成证书格式导出产物', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats', operationId: 'createCertificateVersionFormat', summary: '创建证书格式产物记录', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'PATCH', path: '/api/v1/certificate-version-formats', operationId: 'updateCertificateVersionFormat', summary: '更新证书格式产物记录', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
    { method: 'POST', path: '/api/v1/certificate-version-formats/delete', operationId: 'deleteCertificateVersionFormat', summary: '删除证书格式产物记录', tags: ['Certificates'], responseSchema: certificateVersionFormatSchema },
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
