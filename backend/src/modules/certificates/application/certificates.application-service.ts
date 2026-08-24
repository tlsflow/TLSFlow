import { X509Certificate, createHash } from 'node:crypto';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { sha256Fingerprint } from '../../../common/crypto/fingerprint.js';
import { newId } from '../../../shared/id.js';
import type { PageResponse } from '../../../shared/dto/page-response.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { AuditService } from '../../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { PgCertificateArtifactStore, type CertificateArtifactStore } from '../artifacts/certificate-artifact-store.js';
import { CertificateFormatExporter } from './certificate-format-exporter.js';
import { CertificatesDomainService } from '../domain/certificates.domain-service.js';
import {
  type CertificatesRepository,
  PgCertificatesRepository,
  buildParameterHash,
} from '../repository/certificates.repository.js';
import {
  type CertificateAssetDto,
  type CertificateAssetDetailDto,
  type CertificateFormatCapabilitiesDto,
  type CertificateUsageDto,
  type CertificateVersionDetailDto,
  type CertificateVersionDto,
  type CertificateVersionFormatDto,
  type CertificateFormatExportPlanDto,
  type CertificateSourceSyncInput,
  type CertificateSourceSyncResult,
  type CreateCertificateAssetInput,
  type CreateCertificateVersionFormatInput,
  type ImportCertificateVersionInput,
  type ImportCertificateVersionResult,
  type ValidateCertificateImportResult,
  type RequestCertificateFormatExportInput,
  type ChangeCertificateAssetStatusInput,
  type ChangeCertificateVersionStatusInput,
  toCertificateAssetDto,
  toCertificateVersionDto,
  toCertificateVersionFormatDto,
} from '../dto/certificates.dto.js';
import {
  type CertificateAssetEntity,
  type CertificateDistinguishedName,
  type CertificateSourceType,
  type CertificateVersionEntity,
  certificateFormats,
} from '../schema/certificates.schema.js';

export interface CertificatesApplicationDependencies {
  db?: DatabasePort;
  repository?: CertificatesRepository;
  secrets: SecretService;
  audit?: AuditService;
  domain?: CertificatesDomainService;
  artifacts?: CertificateArtifactStore;
  exporter?: CertificateFormatExporter;
}

export class CertificatesApplicationService {
  private readonly db: DatabasePort;
  private readonly repository: CertificatesRepository;
  private readonly artifacts: CertificateArtifactStore;
  private readonly domain: CertificatesDomainService;
  private readonly exporter: CertificateFormatExporter;
  constructor(
    private readonly dependencies: CertificatesApplicationDependencies,
  ) {
    this.db = dependencies.db ?? new PgliteDatabase();
    this.repository = dependencies.repository ?? new PgCertificatesRepository(this.db);
    this.domain = dependencies.domain ?? new CertificatesDomainService();
    this.artifacts = dependencies.artifacts ?? new PgCertificateArtifactStore(this.db);
    this.exporter = dependencies.exporter ?? new CertificateFormatExporter();
  }

  async createAsset(input: CreateCertificateAssetInput): Promise<CertificateAssetDto> {
    const now = new Date().toISOString();
    const asset = await this.repository.createAsset({
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

  async listAssets(query: PageQuery): Promise<PageResponse<CertificateAssetDto>> {
    const page = await this.repository.listAssets(query);
    return { ...page, items: page.items.map(toCertificateAssetDto) };
  }

  async listVersions(query: PageQuery): Promise<PageResponse<CertificateVersionDto>> {
    const page = await this.repository.listVersions(query);
    return { ...page, items: page.items.map(toCertificateVersionDto) };
  }

  async listFormats(query: PageQuery): Promise<PageResponse<CertificateVersionFormatDto>> {
    const page = await this.repository.listFormats(query);
    return { ...page, items: page.items.map(toCertificateVersionFormatDto) };
  }

  getFormatCapabilities(): CertificateFormatCapabilitiesDto {
    return { formats: [...this.domain.getFormatCapabilities().formats].map((item) => ({ ...item, limitations: [...item.limitations] })) };
  }

  async getAssetDetail(id: string): Promise<CertificateAssetDetailDto> {
    const asset = await this.getExistingAsset(id);
    const versions = (await this.repository.listVersionsByAsset(id)).map(toCertificateVersionDto);
    return {
      ...toCertificateAssetDto(asset),
      versions,
      currentVersion: asset.currentVersionId ? versions.find((version) => version.id === asset.currentVersionId) : undefined,
    };
  }

  async getVersionDetail(id: string): Promise<CertificateVersionDetailDto> {
    const version = await this.getExistingVersion(id);
    const asset = await this.getExistingAsset(version.certificateAssetId);
    const chainCertificates = await this.buildChainCertificates(version);
    return {
      ...toCertificateVersionDto(version),
      asset: toCertificateAssetDto(asset),
      formats: (await this.repository.listFormatsByVersion(id)).map(toCertificateVersionFormatDto),
      chainCertificates,
    };
  }

  getUsage(query: { certificateAssetId?: string; certificateVersionId?: string; fingerprintSha256?: string }, usages: unknown[] = []): CertificateUsageDto {
    if (!query.certificateAssetId && !query.certificateVersionId && !query.fingerprintSha256) {
      throw new AppError('VALIDATION_FAILED', 'certificateAssetId、certificateVersionId 或 fingerprintSha256 至少提供一个');
    }
    return { ...query, usages, blockedDeletion: usages.length > 0, source: usages.length > 0 ? 'repository' : 'placeholder' };
  }

  async archiveAsset(input: ChangeCertificateAssetStatusInput, context?: RequestContext): Promise<CertificateAssetDto> {
    if (input.status !== 'archived') throw new AppError('VALIDATION_FAILED', 'archiveAsset 只可设置 archived 状态', { status: input.status });
    return toCertificateAssetDto(await this.changeAssetStatus(input, context));
  }

  async deleteAsset(input: ChangeCertificateAssetStatusInput, usages: unknown[] = [], context?: RequestContext): Promise<CertificateAssetDto> {
    if (usages.length > 0) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书资产存在绑定/部署引用，禁止删除', { usageCount: usages.length });
    return toCertificateAssetDto(await this.changeAssetStatus({ ...input, status: 'deleted' }, context));
  }

  async archiveVersion(input: ChangeCertificateVersionStatusInput, context?: RequestContext): Promise<CertificateVersionDto> {
    return toCertificateVersionDto(await this.changeVersionStatus({ ...input, status: 'archived' }, context));
  }

  async revokeVersion(input: ChangeCertificateVersionStatusInput, context?: RequestContext): Promise<CertificateVersionDto> {
    return toCertificateVersionDto(await this.changeVersionStatus({ ...input, status: 'revoked' }, context));
  }

  async deleteVersion(input: ChangeCertificateVersionStatusInput, usages: unknown[] = [], context?: RequestContext): Promise<CertificateVersionDto> {
    if (usages.length > 0) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书版本存在绑定/部署引用，禁止删除', { usageCount: usages.length });
    return toCertificateVersionDto(await this.changeVersionStatus({ ...input, status: 'deleted' }, context));
  }

  getRepository(): CertificatesRepository {
    return this.repository;
  }

  validateImportVersion(input: ImportCertificateVersionInput): ValidateCertificateImportResult {
    const bundle = this.domain.validateCertificateMaterial(input, input.privateKeyPem);
    return {
      sourceFormat: bundle.sourceFormat,
      importable: bundle.importable,
      blockers: [...bundle.blockers],
      warnings: [...bundle.warnings],
      certificate: {
        commonName: bundle.leaf.commonName,
        sans: [...bundle.leaf.sans],
        issuer: bundle.leaf.issuer,
        subject: bundle.leaf.subject,
        serialNumber: bundle.leaf.serialNumber,
        notBefore: bundle.leaf.notBefore,
        notAfter: bundle.leaf.notAfter,
        fingerprintSha256: bundle.leaf.fingerprintSha256,
        publicKeyAlgorithm: bundle.leaf.publicKeyAlgorithm,
        signatureAlgorithm: bundle.leaf.signatureAlgorithm,
      },
      privateKey: {
        provided: Boolean(input.privateKeyPem ?? bundle.decodedPrivateKeyPem),
        matched: bundle.privateKeyMatched,
        source: bundle.privateKeySource,
      },
      chain: {
        status: bundle.chainStatus,
        order: [...bundle.chainOrder],
        diagnostics: [...bundle.chainDiagnostics],
        certificateCount: bundle.certificates.length,
        certificates: bundle.chainOrder
          .map((fingerprint, index) => {
            const certificate = bundle.certificates.find((item) => item.fingerprintSha256 === fingerprint);
            if (!certificate) return null;
            const isRoot = certificate.subject.raw === certificate.issuer.raw;
            const role: 'leaf' | 'intermediate' | 'root' = index === 0 ? 'leaf' : (isRoot ? 'root' : 'intermediate');
            return {
              fingerprintSha256: certificate.fingerprintSha256,
              displayName: certificate.commonName ?? certificate.subject.commonName ?? certificate.subject.organization ?? certificate.subject.raw,
              commonName: certificate.commonName,
              subject: certificate.subject,
              issuer: certificate.issuer,
              role,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null),
      },
    };
  }

  async importVersion(input: ImportCertificateVersionInput, context?: RequestContext): Promise<ImportCertificateVersionResult> {
    const bundle = this.domain.validateCertificateMaterial(input, input.privateKeyPem);
    this.assertImportableChain(bundle.importable, bundle.blockers);
    const parsed = bundle.leaf;
    if (await this.repository.getVersionByFingerprint(parsed.fingerprintSha256)) {
      throw new AppError('CERT_DUPLICATE_VERSION', '重复 fingerprintSha256 的证书版本已存在', {
        fingerprintSha256: parsed.fingerprintSha256,
      });
    }

    let privateKeySecretRef: string | undefined;
    let privateKeyMatched = false;
    const privateKeyPem = this.domain.extractPrivateKeyPem(input.privateKeyPem ?? bundle.decodedPrivateKeyPem);
    if (privateKeyPem) {
      this.domain.assertPrivateKeyMatchesCertificate(privateKeyPem, parsed);
      privateKeyMatched = true;
      privateKeySecretRef = (await this.dependencies.secrets.create({
        name: `证书私钥 ${parsed.commonName ?? parsed.fingerprintSha256.slice(0, 12)}`,
        type: 'certificate_private_key',
        scopeType: 'global',
        plainText: privateKeyPem,
        createdBy: input.createdBy,
      }, context)).secretRef;
    }

    const asset = input.certificateAssetId
      ? await this.getExistingAsset(input.certificateAssetId)
      : await this.createAssetFromParsed(input, parsed.commonName, parsed.sans);
    const now = new Date().toISOString();
    const versionNo = (await this.repository.countVersionsByAsset(asset.id)) + 1;
    const notExpired = new Date(parsed.notAfter).getTime() > Date.now();
    const sourceType = input.sourceType ?? asset.sourceType;
    const leafStorageRef = `artifact://certificate-leaf/${sha256Fingerprint(parsed.der, 32)}`;
    await this.artifacts.put({ artifactRef: leafStorageRef, content: parsed.der, contentType: 'application/pkix-cert', createdBy: input.createdBy });
    const chainCertificateRefs = await Promise.all(bundle.certificates
      .filter((certificate) => certificate.fingerprintSha256 !== parsed.fingerprintSha256)
      .map(async (certificate) => {
        const artifactRef = `artifact://certificate-chain/${sha256Fingerprint(certificate.der, 32)}`;
        await this.artifacts.put({ artifactRef, content: certificate.der, contentType: 'application/pkix-cert', createdBy: input.createdBy });
        return artifactRef;
      }));

    const version = await this.repository.createVersion({
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
      leafStorageRef,
      privateKeySecretRef,
      chainCertificateRefs,
      chainOrder: bundle.chainOrder,
      chainDiagnostics: bundle.chainDiagnostics,
      chainStatus: bundle.chainStatus,
      deployable: Boolean(privateKeySecretRef && privateKeyMatched && notExpired),
      sourceType,
      status: 'active',
      createdBy: input.createdBy,
      createdAt: now,
    });

    const updatedAsset = await this.repository.updateAsset(asset.id, {
      currentVersionId: version.id,
      sans: uniqueStrings([...asset.sans, ...parsed.sans]),
      updatedAt: now,
    });

    void this.dependencies.audit?.write({
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
        sourceFormat: bundle.sourceFormat,
        privateKeySaved: Boolean(privateKeySecretRef),
        privateKeyMatched,
        chainStatus: bundle.chainStatus,
        chainOrder: bundle.chainOrder,
        chainDiagnostics: [...bundle.formatDiagnostics, ...bundle.chainDiagnostics],
      },
    };
  }

  async createFormat(input: CreateCertificateVersionFormatInput): Promise<CertificateVersionFormatDto> {
    if (!certificateFormats.includes(input.format)) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', '证书格式不合法', { format: input.format });
    }
    if (!input.artifactRef || !/^[a-z][a-z0-9+.-]*:\/\/.+/i.test(input.artifactRef)) {
      throw new AppError('VALIDATION_FAILED', 'artifactRef 必须是外部产物引用', { field: 'artifactRef' });
    }
    if (!await this.repository.getVersion(input.certificateVersionId)) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
    }

    const parameters = input.parameters ?? {};
    const parameterHash = buildCertificateFormatParameterHash({
      format: input.format,
      containsPrivateKey: Boolean(input.containsPrivateKey),
      passwordSecretRef: input.passwordSecretRef,
      parameters,
    });
    const existing = await this.repository.getFormatByNaturalKey(input.certificateVersionId, input.format, parameterHash);
    if (existing) return toCertificateVersionFormatDto(existing);

    const format = await this.repository.createFormat({
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

  async requestFormatExport(input: RequestCertificateFormatExportInput, context?: RequestContext): Promise<CertificateFormatExportPlanDto> {
    const version = await this.repository.getVersion(input.certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
    }
    const warnings: string[] = [];
    if (!certificateFormats.includes(input.format)) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', '证书格式不合法', { format: input.format });
    }
    if ((input.format === 'der' || input.format === 'p7b') && input.containsPrivateKey) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', 'DER/P7B 格式不能包含私钥', { format: input.format });
    }
    if (input.containsPrivateKey && !version.privateKeySecretRef) {
      throw new AppError('VALIDATION_FAILED', '证书版本没有私钥 SecretRef，不能规划包含私钥的格式导出', { certificateVersionId: input.certificateVersionId });
    }
    if ((input.format === 'pfx' || input.format === 'jks') && !input.passwordSecretRef) {
      throw new AppError('VALIDATION_FAILED', 'PFX/JKS 导出必须提供 passwordSecretRef', { format: input.format });
    }
    if (version.chainStatus !== 'valid') {
      warnings.push(`证书链状态为 ${version.chainStatus}，导出产物只可用于修复或人工确认场景`);
    }
    const parameters = input.parameters ?? {};
    const parameterHash = buildCertificateFormatParameterHash({
      format: input.format,
      containsPrivateKey: Boolean(input.containsPrivateKey),
      passwordSecretRef: input.passwordSecretRef,
      privateKeySecretRef: input.containsPrivateKey ? version.privateKeySecretRef : undefined,
      parameters,
    });
    const artifactRef = `artifact://certificate-format/${input.certificateVersionId}/${input.format}/${parameterHash.slice(0, 16)}`;
    const format = await this.createFormat({
      certificateVersionId: input.certificateVersionId,
      format: input.format,
      artifactRef,
      containsPrivateKey: input.containsPrivateKey,
      passwordSecretRef: input.passwordSecretRef,
      parameters,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt,
    });
    void this.dependencies.audit?.write({
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

  private async buildChainCertificates(version: CertificateVersionEntity): Promise<CertificateVersionDetailDto['chainCertificates']> {
    const leaf = this.readCertificateSummary(Buffer.from(await this.readArtifact(version.leafStorageRef)));
    const byFingerprint = new Map<string, Omit<CertificateVersionDetailDto['chainCertificates'][number], 'role'>>([
      [
        leaf.fingerprintSha256,
        {
          fingerprintSha256: leaf.fingerprintSha256,
          displayName: leaf.displayName,
          commonName: leaf.commonName,
          subject: leaf.subject,
          issuer: leaf.issuer,
        },
      ],
    ]);
    for (const artifactRef of version.chainCertificateRefs) {
      const certificate = this.readCertificateSummary(Buffer.from(await this.readArtifact(artifactRef)));
      byFingerprint.set(certificate.fingerprintSha256, certificate);
    }
    return version.chainOrder.map((fingerprint, index) => {
      const certificate = byFingerprint.get(fingerprint);
      if (!certificate) {
        return {
          fingerprintSha256: fingerprint,
          displayName: fingerprint,
          commonName: undefined,
          subject: { raw: fingerprint },
          issuer: { raw: fingerprint },
          role: index === 0 ? 'leaf' : 'intermediate',
        } satisfies CertificateVersionDetailDto['chainCertificates'][number];
      }
      const isRoot = certificate.subject.raw === certificate.issuer.raw;
      return {
        ...certificate,
        role: index === 0 ? 'leaf' : (isRoot ? 'root' : 'intermediate'),
      };
    });
  }

  private readCertificateSummary(der: Buffer): Omit<CertificateVersionDetailDto['chainCertificates'][number], 'role'> {
    const certificate = new X509Certificate(der);
    const subject = parseDistinguishedName(certificate.subject);
    const issuer = parseDistinguishedName(certificate.issuer);
    const commonName = subject.commonName;
    return {
      fingerprintSha256: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
      displayName: commonName ?? subject.organization ?? subject.raw,
      commonName,
      subject,
      issuer,
    };
  }

  async generateFormatExport(input: RequestCertificateFormatExportInput, context?: RequestContext): Promise<CertificateFormatExportPlanDto> {
    const version = await this.repository.getVersion(input.certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
    }
    const warnings = this.validateFormatExportRequest(input, version);
    const parameters = input.parameters ?? {};
    const privateKey = input.containsPrivateKey
      ? await this.resolveSecret(version.privateKeySecretRef, 'certificate_private_key', 'certificate.format.export.private_key', input.createdBy, context)
      : undefined;
    const password = input.passwordSecretRef
      ? await this.resolveSecret(input.passwordSecretRef, 'pfx_password', 'certificate.format.export.password', input.createdBy, context)
      : undefined;
    const parameterHash = buildCertificateFormatParameterHash({
      format: input.format,
      containsPrivateKey: Boolean(input.containsPrivateKey),
      passwordSecretRef: password?.secretRef ?? input.passwordSecretRef,
      passwordFingerprint: password?.fingerprint,
      privateKeySecretRef: privateKey?.secretRef ?? (input.containsPrivateKey ? version.privateKeySecretRef : undefined),
      privateKeyFingerprint: privateKey?.fingerprint,
      parameters,
    });
    const artifactRef = `artifact://certificate-format/${input.certificateVersionId}/${input.format}/${parameterHash.slice(0, 16)}`;
    const generated = this.exporter.generate(input.format, {
      version,
      leafDer: await this.readArtifact(version.leafStorageRef),
      chainDer: await Promise.all(version.chainCertificateRefs.map((artifactRef) => this.readArtifact(artifactRef))),
      privateKeyPem: privateKey?.plainText,
      password: password?.plainText,
      parameters,
    });
    await this.artifacts.put({
      artifactRef,
      content: generated.content,
      contentType: generated.contentType,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt,
    });
    const format = await this.createFormat({
      certificateVersionId: input.certificateVersionId,
      format: input.format,
      artifactRef,
      containsPrivateKey: input.containsPrivateKey,
      passwordSecretRef: input.passwordSecretRef,
      parameters: { ...parameters, passwordSecretRef: password?.secretRef, privateKeySecretRef: privateKey?.secretRef },
      createdBy: input.createdBy,
      expiresAt: input.expiresAt,
    });
    void this.dependencies.audit?.write({
      eventType: AUDIT_EVENT_TYPES.CERTIFICATE_IMPORTED,
      actorType: 'user',
      actorId: input.createdBy,
      action: 'certificate.format.export.generate',
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
    return { ...format, exportMode: 'generated', warnings: [...warnings, ...generated.warnings] };
  }

  async syncFromSource(input: CertificateSourceSyncInput, context?: RequestContext): Promise<CertificateSourceSyncResult> {
    if (input.sourceType === 'manual') {
      throw new AppError('VALIDATION_FAILED', '来源同步不能使用 manual，手工导入请调用导入接口', { sourceType: input.sourceType });
    }
    const imported = await this.importVersion({
      certificatePem: input.certificatePem,
      pfxBase64: input.pfxBase64,
      pfxPassword: input.pfxPassword,
      declaredFormat: input.declaredFormat,
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

  private async getExistingVersion(id: string): Promise<CertificateVersionEntity> {
    const version = await this.repository.getVersion(id);
    if (!version || version.status === 'deleted') {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: id });
    }
    return version;
  }

  private validateFormatExportRequest(input: RequestCertificateFormatExportInput, version: CertificateVersionEntity): string[] {
    const warnings: string[] = [];
    if (!certificateFormats.includes(input.format)) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', '证书格式不合法', { format: input.format });
    }
    if ((input.format === 'der' || input.format === 'p7b') && input.containsPrivateKey) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', 'DER/P7B 格式不能包含私钥', { format: input.format });
    }
    if ((input.format === 'pfx' || input.format === 'jks') && !input.containsPrivateKey) {
      throw new AppError('VALIDATION_FAILED', 'PFX/JKS 导出必须包含私钥', { format: input.format });
    }
    if (input.containsPrivateKey && !version.privateKeySecretRef) {
      throw new AppError('VALIDATION_FAILED', '证书版本没有私钥 SecretRef，不能导出包含私钥的格式', { certificateVersionId: input.certificateVersionId });
    }
    if ((input.format === 'pfx' || input.format === 'jks') && !input.passwordSecretRef) {
      throw new AppError('VALIDATION_FAILED', 'PFX/JKS 导出必须提供 passwordSecretRef', { format: input.format });
    }
    if (version.chainStatus !== 'valid') {
      warnings.push(`证书链状态为 ${version.chainStatus}，导出产物只可用于修复或人工确认场景`);
    }
    return warnings;
  }

  private async readArtifact(artifactRef: string): Promise<Buffer> {
    const artifact = await this.artifacts.get(artifactRef);
    if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', '证书材料产物不存在，无法导出格式', { artifactRef });
    return artifact.content;
  }

  private async resolveSecret(
    secretRef: string | undefined,
    expectedType: Parameters<SecretService['resolveForService']>[0]['expectedType'],
    purpose: string,
    actorId: string,
    context?: RequestContext,
  ) {
    if (!secretRef) return undefined;
    return this.dependencies.secrets.resolveForService({ secretRef, expectedType, purpose, actorId, context });
  }

  private async changeAssetStatus(input: ChangeCertificateAssetStatusInput, context?: RequestContext): Promise<CertificateAssetEntity> {
    const asset = await this.getExistingAsset(input.id);
    const updated = await this.repository.deleteOrUpdateAsset(asset.id, { status: input.status, updatedAt: new Date().toISOString() });
    void this.writeLifecycleAudit('certificate.asset.status', 'certificate_asset', updated.id, input.actorId, input.status, context);
    return updated;
  }

  private async changeVersionStatus(input: ChangeCertificateVersionStatusInput, context?: RequestContext): Promise<CertificateVersionEntity> {
    const version = await this.getExistingVersion(input.id);
    const updated = await this.repository.deleteOrUpdateVersion(version.id, { status: input.status, deployable: input.status === 'active' ? version.deployable : false });
    if (input.status === 'deleted') {
      const asset = await this.repository.getAsset(updated.certificateAssetId);
      if (asset?.currentVersionId === updated.id) {
        const replacement = (await this.repository.listVersionsByAsset(asset.id)).find((candidate) => candidate.id !== updated.id && candidate.status === 'active');
        await this.repository.updateAsset(asset.id, { currentVersionId: replacement?.id, updatedAt: new Date().toISOString() });
      }
    }
    void this.writeLifecycleAudit('certificate.version.status', 'certificate_version', updated.id, input.actorId, input.status, context);
    return updated;
  }

  private async writeLifecycleAudit(action: string, resourceType: string, resourceId: string, actorId: string, status: string, context?: RequestContext): Promise<void> {
    await this.dependencies.audit?.write({
      eventType: AUDIT_EVENT_TYPES.CERTIFICATE_IMPORTED,
      actorType: 'user',
      actorId,
      action,
      resourceType,
      resourceId,
      result: 'success',
      riskLevel: status === 'deleted' ? 'high' : 'medium',
      context,
      detail: { status },
    });
  }

  private async getExistingAsset(id: string): Promise<CertificateAssetEntity> {
    const asset = await this.repository.getAsset(id);
    if (!asset || asset.status === 'deleted') {
      throw new AppError('RESOURCE_NOT_FOUND', '证书资产不存在', { certificateAssetId: id });
    }
    return asset;
  }

  private assertImportableChain(importable: boolean, blockers: string[]): void {
    if (!importable) {
      throw new AppError('CERT_PARSE_FAILED', blockers[0] ?? '璇佷功鏉愭枡涓嶅彲瀵煎叆', { blockers });
    }
  }

  private async createAssetFromParsed(input: ImportCertificateVersionInput, commonName: string | undefined, sans: string[]): Promise<CertificateAssetEntity> {
    const primaryDomain = commonName ?? sans[0];
    if (!primaryDomain) {
      throw new AppError('CERT_PARSE_FAILED', '证书缺少 commonName 和 SAN，无法创建逻辑资产');
    }
    const created = await this.createAsset({
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

function parseDistinguishedName(value: string): CertificateDistinguishedName {
  const output: CertificateDistinguishedName = { raw: value };
  for (const line of value.split(/\n|,\s*/).map((item) => item.trim()).filter(Boolean)) {
    const [key, ...rest] = line.split('=');
    const fieldValue = rest.join('=');
    if (!key || !fieldValue) continue;
    switch (key) {
      case 'CN':
        output.commonName = fieldValue;
        break;
      case 'O':
        output.organization = fieldValue;
        break;
      case 'OU':
        output.organizationalUnit = fieldValue;
        break;
      case 'C':
        output.country = fieldValue;
        break;
      case 'ST':
        output.state = fieldValue;
        break;
      case 'L':
        output.locality = fieldValue;
        break;
      default:
        break;
    }
  }
  return output;
}

function buildCertificateFormatParameterHash(input: {
  format: string;
  containsPrivateKey: boolean;
  passwordSecretRef?: string;
  passwordFingerprint?: string;
  privateKeySecretRef?: string;
  privateKeyFingerprint?: string;
  parameters?: Record<string, unknown>;
}): string {
  return buildParameterHash({
    format: input.format,
    containsPrivateKey: input.containsPrivateKey,
    passwordSecretRef: input.passwordSecretRef,
    passwordFingerprint: input.passwordFingerprint,
    privateKeySecretRef: input.privateKeySecretRef,
    privateKeyFingerprint: input.privateKeyFingerprint,
    parameters: input.parameters ?? {},
  });
}
