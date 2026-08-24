import { createHash } from 'node:crypto';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { sha256Fingerprint } from '../../../common/crypto/fingerprint.js';
import { newId } from '../../../shared/id.js';
import type { PageResponse } from '../../../shared/dto/page-response.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { AuditService } from '../../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { CertificatesDomainService } from '../domain/certificates.domain-service.js';
import {
  type CertificatesRepository,
  InMemoryCertificatesRepository,
  buildParameterHash,
} from '../repository/certificates.repository.js';
import {
  type CertificateAssetDto,
  type CertificateVersionDto,
  type CertificateVersionFormatDto,
  type CertificateFormatExportPlanDto,
  type CertificateSourceSyncInput,
  type CertificateSourceSyncResult,
  type CreateCertificateAssetInput,
  type CreateCertificateVersionFormatInput,
  type ImportCertificateVersionInput,
  type ImportCertificateVersionResult,
  type RequestCertificateFormatExportInput,
  toCertificateAssetDto,
  toCertificateVersionDto,
  toCertificateVersionFormatDto,
} from '../dto/certificates.dto.js';
import {
  type CertificateAssetEntity,
  type CertificateSourceType,
  type CertificateVersionEntity,
  certificateFormats,
} from '../schema/certificates.schema.js';

export interface CertificatesApplicationDependencies {
  repository?: CertificatesRepository;
  secrets: SecretService;
  audit?: AuditService;
  domain?: CertificatesDomainService;
}

export class CertificatesApplicationService {
  constructor(
    private readonly dependencies: CertificatesApplicationDependencies,
    private readonly repository: CertificatesRepository = dependencies.repository ?? new InMemoryCertificatesRepository(),
    private readonly domain: CertificatesDomainService = dependencies.domain ?? new CertificatesDomainService(),
  ) {}

  createAsset(input: CreateCertificateAssetInput): CertificateAssetDto {
    const now = new Date().toISOString();
    const asset = this.repository.createAsset({
      id: newId('certasset'),
      name: input.name,
      primaryDomain: input.primaryDomain,
      sans: uniqueStrings(input.sans ?? []),
      sourceType: input.sourceType ?? 'manual',
      status: 'active',
      tags: uniqueStrings(input.tags ?? []),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return toCertificateAssetDto(asset);
  }

  listAssets(query: PageQuery): PageResponse<CertificateAssetDto> {
    const page = this.repository.listAssets(query);
    return { ...page, items: page.items.map(toCertificateAssetDto) };
  }

  listVersions(query: PageQuery): PageResponse<CertificateVersionDto> {
    const page = this.repository.listVersions(query);
    return { ...page, items: page.items.map(toCertificateVersionDto) };
  }

  listFormats(query: PageQuery): PageResponse<CertificateVersionFormatDto> {
    const page = this.repository.listFormats(query);
    return { ...page, items: page.items.map(toCertificateVersionFormatDto) };
  }

  getRepository(): CertificatesRepository {
    return this.repository;
  }

  importVersion(input: ImportCertificateVersionInput, context?: RequestContext): ImportCertificateVersionResult {
    const bundle = this.domain.parseCertificateMaterial(input);
    const parsed = bundle.leaf;
    if (this.repository.getVersionByFingerprint(parsed.fingerprintSha256)) {
      throw new AppError('CERT_DUPLICATE_VERSION', '重复 fingerprintSha256 的证书版本已存在', {
        fingerprintSha256: parsed.fingerprintSha256,
      });
    }

    let privateKeySecretRef: string | undefined;
    let privateKeyMatched = false;
    const privateKeyPem = this.domain.extractPrivateKeyPem(input.privateKeyPem);
    if (privateKeyPem) {
      this.domain.assertPrivateKeyMatchesCertificate(privateKeyPem, parsed);
      privateKeyMatched = true;
      privateKeySecretRef = this.dependencies.secrets.create({
        name: `证书私钥 ${parsed.commonName ?? parsed.fingerprintSha256.slice(0, 12)}`,
        type: 'certificate_private_key',
        scopeType: 'global',
        plainText: privateKeyPem,
        createdBy: input.createdBy,
      }, context).secretRef;
    }

    const asset = input.certificateAssetId
      ? this.getExistingAsset(input.certificateAssetId)
      : this.createAssetFromParsed(input, parsed.commonName, parsed.sans);
    const now = new Date().toISOString();
    const versionNo = this.repository.countVersionsByAsset(asset.id) + 1;
    const notExpired = new Date(parsed.notAfter).getTime() > Date.now();
    const sourceType = input.sourceType ?? asset.sourceType;
    const version = this.repository.createVersion({
      id: newId('certver'),
      certificateAssetId: asset.id,
      versionNo,
      commonName: parsed.commonName,
      sans: parsed.sans,
      issuer: parsed.issuer,
      subject: parsed.subject,
      serialNumber: parsed.serialNumber,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      fingerprintSha256: parsed.fingerprintSha256,
      publicKeyAlgorithm: parsed.publicKeyAlgorithm,
      signatureAlgorithm: parsed.signatureAlgorithm,
      leafStorageRef: `artifact://certificate-leaf/${sha256Fingerprint(parsed.der, 32)}`,
      privateKeySecretRef,
      chainCertificateRefs: bundle.certificates
        .filter((certificate) => certificate.fingerprintSha256 !== parsed.fingerprintSha256)
        .map((certificate) => `artifact://certificate-chain/${sha256Fingerprint(certificate.der, 32)}`),
      chainOrder: bundle.chainOrder,
      chainDiagnostics: bundle.chainDiagnostics,
      chainStatus: bundle.chainStatus,
      deployable: Boolean(privateKeySecretRef && privateKeyMatched && notExpired),
      sourceType,
      status: 'active',
      createdBy: input.createdBy,
      createdAt: now,
    });

    const updatedAsset = this.repository.updateAsset(asset.id, {
      currentVersionId: version.id,
      sans: uniqueStrings([...asset.sans, ...parsed.sans]),
      updatedAt: now,
    });

    this.dependencies.audit?.write({
      eventType: AUDIT_EVENT_TYPES.CERTIFICATE_IMPORTED,
      actorType: 'user',
      actorId: input.createdBy,
      action: 'certificate.import',
      resourceType: 'certificate_version',
      resourceId: version.id,
      result: 'success',
      riskLevel: 'medium',
      context,
      detail: {
        certificateAssetId: updatedAsset.id,
        fingerprintSha256: version.fingerprintSha256,
        privateKeySecretRef: version.privateKeySecretRef,
      },
    });

    return {
      asset: toCertificateAssetDto(updatedAsset),
      version: toCertificateVersionDto(version),
      diagnostics: {
        sourceFormat: input.certificateDerBase64 ? 'der' : 'pem',
        privateKeySaved: Boolean(privateKeySecretRef),
        privateKeyMatched,
        chainStatus: bundle.chainStatus,
        chainOrder: bundle.chainOrder,
        chainDiagnostics: bundle.chainDiagnostics,
      },
    };
  }

  createFormat(input: CreateCertificateVersionFormatInput): CertificateVersionFormatDto {
    if (!certificateFormats.includes(input.format)) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', '证书格式不合法', { format: input.format });
    }
    if (!input.artifactRef || !/^[a-z][a-z0-9+.-]*:\/\/.+/i.test(input.artifactRef)) {
      throw new AppError('VALIDATION_FAILED', 'artifactRef 必须是外部产物引用', { field: 'artifactRef' });
    }
    if (!this.repository.getVersion(input.certificateVersionId)) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
    }

    const parameters = input.parameters ?? {};
    const parameterHash = buildParameterHash({ format: input.format, containsPrivateKey: Boolean(input.containsPrivateKey), parameters });
    const existing = this.repository.getFormatByNaturalKey(input.certificateVersionId, input.format, parameterHash);
    if (existing) return toCertificateVersionFormatDto(existing);

    const format = this.repository.createFormat({
      id: newId('certfmt'),
      certificateVersionId: input.certificateVersionId,
      format: input.format,
      artifactRef: input.artifactRef,
      parameterHash,
      containsPrivateKey: Boolean(input.containsPrivateKey),
      passwordSecretRef: input.passwordSecretRef,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    });
    return toCertificateVersionFormatDto(format);
  }

  requestFormatExport(input: RequestCertificateFormatExportInput, context?: RequestContext): CertificateFormatExportPlanDto {
    const version = this.repository.getVersion(input.certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
    }
    const warnings: string[] = [];
    if (input.containsPrivateKey && !version.privateKeySecretRef) {
      throw new AppError('VALIDATION_FAILED', '证书版本没有私钥 SecretRef，不能规划包含私钥的格式导出', { certificateVersionId: input.certificateVersionId });
    }
    if (input.containsPrivateKey && ['pfx', 'jks'].includes(input.format) && !input.passwordSecretRef) {
      throw new AppError('VALIDATION_FAILED', 'PFX/JKS 私钥导出必须提供 passwordSecretRef', { format: input.format });
    }
    if (version.chainStatus !== 'valid') {
      warnings.push(`证书链状态为 ${version.chainStatus}，导出产物只能用于修复或人工确认场景`);
    }
    const parameters = input.parameters ?? {};
    const parameterHash = buildParameterHash({ format: input.format, containsPrivateKey: Boolean(input.containsPrivateKey), parameters });
    const artifactRef = `artifact://certificate-format/${input.certificateVersionId}/${input.format}/${parameterHash.slice(0, 16)}`;
    const format = this.createFormat({
      certificateVersionId: input.certificateVersionId,
      format: input.format,
      artifactRef,
      containsPrivateKey: input.containsPrivateKey,
      passwordSecretRef: input.passwordSecretRef,
      parameters,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt,
    });
    this.dependencies.audit?.write({
      eventType: AUDIT_EVENT_TYPES.CERTIFICATE_IMPORTED,
      actorType: 'user',
      actorId: input.createdBy,
      action: 'certificate.format.export.plan',
      resourceType: 'certificate_version_format',
      resourceId: format.id,
      result: 'success',
      riskLevel: input.containsPrivateKey ? 'high' : 'medium',
      context,
      detail: {
        certificateVersionId: input.certificateVersionId,
        format: input.format,
        containsPrivateKey: Boolean(input.containsPrivateKey),
        artifactRef,
      },
    });
    return { ...format, exportMode: 'planned', warnings };
  }

  syncFromSource(input: CertificateSourceSyncInput, context?: RequestContext): CertificateSourceSyncResult {
    if (input.sourceType === 'manual') {
      throw new AppError('VALIDATION_FAILED', '来源同步不能使用 manual，手工导入请调用导入接口', { sourceType: input.sourceType });
    }
    const imported = this.importVersion({
      certificatePem: input.certificatePem,
      certificateDerBase64: input.certificateDerBase64,
      privateKeyPem: input.privateKeyPem,
      sourceType: input.sourceType,
      name: input.name ?? input.externalId,
      tags: uniqueStrings([...(input.tags ?? []), `source:${input.sourceType}`, `external:${input.externalId}`]),
      createdBy: input.createdBy,
    }, context);
    return {
      sourceType: input.sourceType,
      externalId: input.externalId,
      imported: true,
      asset: imported.asset,
      version: imported.version,
    };
  }

  private getExistingAsset(id: string): CertificateAssetEntity {
    const asset = this.repository.getAsset(id);
    if (!asset || asset.status === 'deleted') {
      throw new AppError('RESOURCE_NOT_FOUND', '证书资产不存在', { certificateAssetId: id });
    }
    return asset;
  }

  private createAssetFromParsed(input: ImportCertificateVersionInput, commonName: string | undefined, sans: string[]): CertificateAssetEntity {
    const primaryDomain = commonName ?? sans[0];
    if (!primaryDomain) {
      throw new AppError('CERT_PARSE_FAILED', '证书缺少 commonName 和 SAN，无法创建逻辑资产');
    }
    const created = this.createAsset({
      name: input.name ?? primaryDomain,
      primaryDomain,
      sans,
      sourceType: input.sourceType,
      tags: input.tags,
      createdBy: input.createdBy,
    });
    return this.getExistingAsset(created.id);
  }
}

export function hashCertificateMaterial(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
