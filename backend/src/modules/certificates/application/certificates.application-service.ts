import { X509Certificate, createHash, randomBytes } from 'node:crypto';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { sha256Fingerprint } from '../../../common/crypto/fingerprint.js';
import { SecurityError } from '../../../shared/security-error.js';
import { newId } from '../../../shared/id.js';
import type { PageResponse } from '../../../shared/dto/page-response.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { AuditService } from '../../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { PgCertificateArtifactStore, type CertificateArtifactStore } from '../artifacts/certificate-artifact-store.js';
import { CertificateFormatExporter, type GeneratedCertificateFormatArtifact } from './certificate-format-exporter.js';
import { CertificatesDomainService } from '../domain/certificates.domain-service.js';
import type { CertificateVersionEventPublisher } from '../../automations/application/automation-event-delivery.service.js';
import { TrustRootsApplicationService } from '../trust-roots/application/trust-roots.application-service.js';
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
  type CertificateArtifactFileDto,
  type CertificateVersionDetailDto,
  type CertificateVersionDto,
  type CertificateVersionFormatDto,
  type CertificateSourceSyncInput,
  type CertificateSourceSyncResult,
  type CreateCertificateAssetInput,
  type CreateCertificateVersionFormatInput,
  type ImportCertificateVersionInput,
  type ImportCertificateVersionResult,
  type ValidateCertificateImportResult,
  type UpdateCertificateVersionFormatInput,
  type DeleteCertificateVersionFormatInput,
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
  type CertificateVersionFormatEntity,
  certificateFormats,
} from '../schema/certificates.schema.js';

/**
 * 宿主默认证书产物配置文件（模板）：一个扩展名一个配置，配置即完整产物规范
 * （格式编码 + 输出扩展名 + 包含内容 + 密码要求），应用资产配置时直接选用即可，
 * 无需再按扩展名分支。与插件配方 certificate.acceptedFormats 的标准格式码对应。
 * - .der  DER   二进制单证书（无私钥，Java）
 * - .cer  DER   二进制单证书（无私钥，Windows 惯例）
 * - .crt  PEM   证书文件 leaf+chain（无私钥，Apache/Nginx 惯例）
 * - .pem  PEM   Bundle：公钥+证书链+私钥（Apache/Nginx）
 * - .p7b  PKCS#7 证书链+leaf（无私钥，Tomcat/Windows）
 * - .p7c  PKCS#7 证书链+leaf（无私钥）
 * - .spc  PKCS#7 证书链+leaf（无私钥，Windows）
 * - .pfx  PKCS#12 leaf+链+私钥+密码（Windows Server）
 * - .p12  PKCS#12 leaf+链+私钥+密码（Windows Server）
 * - .jks  JKS   leaf+链+私钥+密码（Tomcat）
 * 这些是"配置文件"而非产物本身——证书版本只保存公钥/私钥材料，
 * 实际产物在部署时按配置文件 + 证书材料按需生成。
 * 每次后端启动时默认补全（幂等，已存在配置原地对齐），且不允许删除。
 */
const DEFAULT_FORMAT_CONFIGS: ReadonlyArray<{
  format: (typeof certificateFormats)[number];
  containsPrivateKey: boolean;
  parameters: Record<string, unknown>;
}> = [
  { format: 'der', containsPrivateKey: false, parameters: { configName: '宿主默认 DER 证书', extension: 'der' } },
  { format: 'der', containsPrivateKey: false, parameters: { configName: '宿主默认 CER 证书', extension: 'cer' } },
  { format: 'pem', containsPrivateKey: false, parameters: { configName: '宿主默认 CRT 证书', extension: 'crt', includeLeafCertificate: true, includeCertificateChain: true } },
  { format: 'pem', containsPrivateKey: true, parameters: { configName: '宿主默认 PEM Bundle', extension: 'pem', includeLeafCertificate: true, includeCertificateChain: true, includePrivateKey: true } },
  { format: 'p7b', containsPrivateKey: false, parameters: { configName: '宿主默认 P7B 证书链', extension: 'p7b', includeLeafCertificate: true, includeCertificateChain: true } },
  { format: 'p7b', containsPrivateKey: false, parameters: { configName: '宿主默认 P7C 证书链', extension: 'p7c', includeLeafCertificate: true, includeCertificateChain: true } },
  { format: 'p7b', containsPrivateKey: false, parameters: { configName: '宿主默认 SPC 证书链', extension: 'spc', includeLeafCertificate: true, includeCertificateChain: true } },
  { format: 'pfx', containsPrivateKey: true, parameters: { configName: '宿主默认 PFX 容器', extension: 'pfx' } },
  { format: 'pfx', containsPrivateKey: true, parameters: { configName: '宿主默认 P12 容器', extension: 'p12' } },
  { format: 'jks', containsPrivateKey: true, parameters: { configName: '宿主默认 JKS 容器', extension: 'jks' } },
];

export interface CertificatesApplicationDependencies {
  db?: DatabasePort;
  repository?: CertificatesRepository;
  secrets: SecretService;
  audit?: AuditService;
  domain?: CertificatesDomainService;
  artifacts?: CertificateArtifactStore;
  exporter?: CertificateFormatExporter;
  /** PFX 只能由显式注册的 Plugin Runner 产物生成器提供。 */
  pfxExporter?: CertificateFormatExporter;
  versionEvents?: CertificateVersionEventPublisher;
  trustRoots?: TrustRootsApplicationService;
}

export class CertificatesApplicationService {
  private readonly db: DatabasePort;
  private readonly repository: CertificatesRepository;
  private readonly artifacts: CertificateArtifactStore;
  private readonly domain: CertificatesDomainService;
  private readonly exporter: CertificateFormatExporter;
  private readonly pfxExporter?: CertificateFormatExporter;
  private readonly trustRoots: TrustRootsApplicationService;
  constructor(
    private readonly dependencies: CertificatesApplicationDependencies,
  ) {
    this.db = dependencies.db ?? new PgliteDatabase();
    this.repository = dependencies.repository ?? new PgCertificatesRepository(this.db);
    this.domain = dependencies.domain ?? new CertificatesDomainService();
    this.artifacts = dependencies.artifacts ?? new PgCertificateArtifactStore(this.db);
    this.exporter = dependencies.exporter ?? new CertificateFormatExporter();
    this.pfxExporter = dependencies.pfxExporter;
    this.trustRoots = dependencies.trustRoots ?? new TrustRootsApplicationService({
      db: this.db,
      certificates: this.repository,
      artifacts: this.artifacts,
    });
  }

  async createAsset(input: CreateCertificateAssetInput): Promise<CertificateAssetDto> {
    const now = new Date().toISOString();
    const primaryDomain = normalizeCertificateDomain(input.primaryDomain);
    const existing = await this.repository.findAssetByPrimaryDomain(primaryDomain, input.tenantId);
    if (existing) {
      const updated = await this.repository.updateAsset(existing.id, {
        name: existing.name || input.name || primaryDomain,
        sans: uniqueStrings([...existing.sans, ...(input.sans ?? []).map(normalizeCertificateDomain)]),
        tags: uniqueStrings([...existing.tags, ...(input.tags ?? [])]),
        updatedAt: now,
      }, input.tenantId);
      return toCertificateAssetDto(updated);
    }
    const asset = await this.repository.createAsset({
      id: newId('certasset'),
      tenantId: input.tenantId,
      name: input.name ?? primaryDomain,
      primaryDomain,
      sans: uniqueStrings((input.sans ?? []).map(normalizeCertificateDomain)),
      sourceType: input.sourceType ?? 'manual',
      status: 'active',
      tags: uniqueStrings(input.tags ?? []),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return toCertificateAssetDto(asset);
  }

  async listAssets(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateAssetDto>> {
    const page = await this.repository.listAssets(query, tenantId);
    return { ...page, items: page.items.map(toCertificateAssetDto) };
  }

  async listVersions(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateVersionDto>> {
    const page = await this.repository.listVersions(query, tenantId);
    return { ...page, items: page.items.map(toCertificateVersionDto) };
  }

  async listFormats(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateVersionFormatDto>> {
    const page = await this.repository.listFormats(query, tenantId);
    return { ...page, items: page.items.map(toCertificateVersionFormatDto) };
  }

  getFormatCapabilities(): CertificateFormatCapabilitiesDto {
    return { formats: [...this.domain.getFormatCapabilities().formats].map((item) => ({ ...item, limitations: [...item.limitations] })) };
  }

  async getAssetDetail(id: string, tenantId?: string): Promise<CertificateAssetDetailDto> {
    const asset = await this.getExistingAsset(id, tenantId);
    const versions = (await this.repository.listVersionsByAsset(id, tenantId)).map(toCertificateVersionDto);
    return {
      ...toCertificateAssetDto(asset),
      versions,
      currentVersion: asset.currentVersionId ? versions.find((version) => version.id === asset.currentVersionId) : undefined,
    };
  }

  async getVersionDetail(id: string, tenantId?: string): Promise<CertificateVersionDetailDto> {
    const version = await this.getExistingVersion(id, tenantId);
    const asset = await this.getExistingAsset(version.certificateAssetId, tenantId);
    const chainCertificates = await this.buildChainCertificates(version, tenantId);
    const trustRoots = await this.trustRoots.getVersionTrustRoots(version.id, tenantId);
    return {
      ...toCertificateVersionDto(version),
      asset: toCertificateAssetDto(asset),
      formats: (await this.repository.listFormatsByVersion(id, tenantId)).map(toCertificateVersionFormatDto),
      chainCertificates,
      trustRoots,
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

  getTrustRoots(): TrustRootsApplicationService {
    return this.trustRoots;
  }

  async promoteVersion(input: {
    certificateVersionId: string;
    actorId: string;
    tenantId?: string;
  }): Promise<CertificateVersionEntity> {
    const version = await this.getExistingVersion(input.certificateVersionId, input.tenantId);
    if (version.status !== 'active' || version.activationState !== 'staged') {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '证书版本当前不允许 Promotion', {
        certificateVersionId: version.id,
        status: version.status,
      });
    }
    const asset = await this.getExistingAsset(version.certificateAssetId, input.tenantId);
    const currentVersion = asset.currentVersionId && asset.currentVersionId !== version.id
      ? await this.repository.getVersion(asset.currentVersionId, input.tenantId)
      : undefined;
    const promoted = await this.repository.promoteVersionAtomic(version.id, input.tenantId);
    void this.dependencies.audit?.write({
      eventType: 'certificate.version.promoted',
      actorType: 'user',
      actorId: input.actorId,
      action: 'certificate.version.promote',
      resourceType: 'certificate_version',
      resourceId: promoted.id,
      result: 'success',
      riskLevel: 'high',
      detail: {
        certificateAssetId: asset.id,
        previousVersionId: currentVersion?.id,
        certificateFingerprintSha256: promoted.fingerprintSha256,
      },
    }).catch(() => undefined);
    return promoted;
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
        publicKeyFingerprintSha256: bundle.leaf.publicKeyFingerprintSha256,
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
    const acceptsExternalKeyReference = Boolean(
      input.allowCertificateOnly
      || input.existingPrivateKeySecretRef
      || bundle.sourceFormat === 'der'
      || bundle.sourceFormat === 'p7b',
    );
    const blockers = acceptsExternalKeyReference
      ? bundle.blockers.filter((item) => !item.startsWith('缺少私钥'))
      : bundle.blockers;
    this.assertImportableChain(blockers.length === 0, blockers);
    const parsed = bundle.leaf;
    const existingVersion = await (this.repository.getVersionByFingerprintIncludingDeleted?.(parsed.fingerprintSha256, input.tenantId)
      ?? this.repository.getVersionByFingerprint(parsed.fingerprintSha256, input.tenantId));
    if (existingVersion) {
      throw new AppError('CERT_DUPLICATE_VERSION', '重复 fingerprintSha256 的证书版本已存在', {
        fingerprintSha256: parsed.fingerprintSha256,
      });
    }

    let privateKeySecretRef: string | undefined = input.existingPrivateKeySecretRef;
    let privateKeyMatched = false;
    const privateKeyPem = this.domain.extractPrivateKeyPem(input.privateKeyPem ?? bundle.decodedPrivateKeyPem);
    if (privateKeyPem) {
      this.domain.assertPrivateKeyMatchesCertificate(privateKeyPem, parsed);
      privateKeyMatched = true;
      if (!privateKeySecretRef) {
        privateKeySecretRef = (await this.dependencies.secrets.create({
          tenantId: input.tenantId,
          name: `证书私钥 ${parsed.commonName ?? parsed.fingerprintSha256.slice(0, 12)}`,
          type: 'certificate_private_key',
          scopeType: 'global',
          plainText: privateKeyPem,
          createdBy: input.createdBy,
        }, context)).secretRef;
      }
    }

    const asset = input.certificateAssetId
      ? await this.getExistingAsset(input.certificateAssetId, input.tenantId)
      : await this.createAssetFromParsed(input, parsed.commonName, parsed.sans);
    const now = new Date().toISOString();
    const versionNo = (await this.repository.countVersionsByAsset(asset.id, input.tenantId)) + 1;
    const notExpired = new Date(parsed.notAfter).getTime() > Date.now();
    const sourceType = input.sourceType ?? asset.sourceType;
    const leafStorageRef = `artifact://certificate-leaf/${sha256Fingerprint(parsed.der, 32)}`;
    await this.artifacts.put({ tenantId: input.tenantId, artifactRef: leafStorageRef, content: parsed.der, contentType: 'application/pkix-cert', createdBy: input.createdBy });
    const chainCertificateRefs = await Promise.all(bundle.certificates
      .filter((certificate) => certificate.fingerprintSha256 !== parsed.fingerprintSha256)
      .map(async (certificate) => {
        const artifactRef = `artifact://certificate-chain/${sha256Fingerprint(certificate.der, 32)}`;
        await this.artifacts.put({ tenantId: input.tenantId, artifactRef, content: certificate.der, contentType: 'application/pkix-cert', createdBy: input.createdBy });
        return artifactRef;
      }));

    const version = await this.repository.createVersion({
      id: newId('certver'),
      tenantId: input.tenantId ?? asset.tenantId,
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
      publicKeyFingerprintSha256: parsed.publicKeyFingerprintSha256,
      publicKeyAlgorithm: parsed.publicKeyAlgorithm,
      signatureAlgorithm: parsed.signatureAlgorithm,
      leafStorageRef,
      privateKeySecretRef,
      issuingCaId: input.issuingCaId,
      certificateRequestId: input.certificateRequestId,
      certificateProfileVersionId: input.certificateProfileVersionId,
      keyReferenceId: input.keyReferenceId,
      keyCustodyMode: input.keyCustodyMode,
      chainCertificateRefs,
      chainOrder: bundle.chainOrder,
      chainDiagnostics: bundle.chainDiagnostics,
      chainStatus: bundle.chainStatus,
      deployable: Boolean(notExpired && (
        (privateKeySecretRef && (privateKeyMatched || Boolean(input.existingPrivateKeySecretRef)))
        || (input.allowCertificateOnly && input.keyReferenceId)
      )),
      sourceType,
      activationState: input.activationState ?? 'promoted',
      status: 'active',
      createdBy: input.createdBy,
      createdAt: now,
    });
    await this.trustRoots.syncImportedVersionRoot(version, bundle, input.createdBy);

    const updatedAsset = await this.repository.updateAsset(asset.id, {
      ...(version.activationState === 'promoted' ? { currentVersionId: version.id } : {}),
      sans: uniqueStrings([...asset.sans, ...parsed.sans.map(normalizeCertificateDomain)]),
      updatedAt: now,
    }, input.tenantId);

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
        keyCustodyMode: version.keyCustodyMode,
      },
    }).catch(() => undefined);

    const eventSourceType: 'manual_import' | 'acme_issue' = sourceType === 'acme' ? 'acme_issue' : 'manual_import';
    const eventTenantId = input.tenantId ?? asset.tenantId ?? version.tenantId ?? updatedAsset.tenantId;
    if (!eventTenantId) throw new AppError('VALIDATION_FAILED', '证书版本事件缺少 tenantId');
    void this.dependencies.versionEvents?.publishCertificateVersionCreated({
      eventType: 'certificate.version.created',
      tenantId: eventTenantId,
      eventId: version.id,
      certificateAssetId: updatedAsset.id,
      certificateVersionId: version.id,
      sourceType: eventSourceType,
      domains: uniqueStrings([updatedAsset.primaryDomain, ...updatedAsset.sans].filter(Boolean)),
      tags: [...updatedAsset.tags],
      occurredAt: version.createdAt,
    }).catch(() => undefined);

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
    if (input.certificateVersionId && !await this.repository.getVersion(input.certificateVersionId, input.tenantId)) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
    }
    this.assertPasswordSecretRef(input.format, input.passwordSecretRef);

    const parameters = input.parameters ?? {};
    const parameterHash = buildCertificateFormatParameterHash({
      format: input.format,
      containsPrivateKey: Boolean(input.containsPrivateKey),
      passwordSecretRef: input.passwordSecretRef,
      parameters,
    });
    // 无论是否绑定证书版本都按自然键去重：全局模板（certificateVersionId 为空）同样不能重复创建。
    const existing = await this.repository.getFormatByNaturalKey(input.certificateVersionId, input.format, parameterHash, input.tenantId);
    if (existing) return toCertificateVersionFormatDto(existing);

    const format = await this.repository.createFormat({
      id: newId('certfmt'),
      tenantId: input.tenantId,
      certificateVersionId: input.certificateVersionId,
      format: input.format,
      artifactRef: this.normalizeFormatConfigArtifactRef(undefined, input.format, input.parameters),
      parameterHash,
      parameters,
      containsPrivateKey: Boolean(input.containsPrivateKey),
      passwordSecretRef: input.passwordSecretRef,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    });
    return toCertificateVersionFormatDto(format);
  }

  /**
   * 启动时补全宿主默认证书产物配置文件（模板，不绑定具体证书版本）。
   * 幂等：已存在的默认配置按 configName 原地对齐（参数变更时更新，不产生重复记录）；
   * PFX/JKS 按格式规范自动生成密码 Secret。证书版本本身只保存公钥/私钥材料，
   * 实际产物在部署时按配置文件 + 证书材料按需生成。
   */
  async ensureDefaultFormatConfigs(createdBy = 'system', tenantId?: string): Promise<{ ensured: number }> {
    let ensured = 0;
    for (const config of DEFAULT_FORMAT_CONFIGS) {
      try {
        const existing = await this.findDefaultFormatConfig(config, tenantId);
        const passwordSecretRef = (config.format === 'pfx' || config.format === 'jks')
          ? (existing?.passwordSecretRef ?? await this.createDefaultConfigPasswordSecret(config, createdBy, tenantId))
          : undefined;
        if (existing) {
          const currentParamsHash = buildCertificateFormatParameterHash({
            format: existing.format,
            containsPrivateKey: Boolean(existing.containsPrivateKey),
            passwordSecretRef: undefined,
            parameters: existing.parameters ?? {},
          });
          const templateParamsHash = buildCertificateFormatParameterHash({
            format: config.format,
            containsPrivateKey: config.containsPrivateKey,
            passwordSecretRef: undefined,
            parameters: config.parameters,
          });
          if (currentParamsHash !== templateParamsHash || (passwordSecretRef !== undefined && existing.passwordSecretRef !== passwordSecretRef)) {
            await this.updateFormat({
              id: existing.id,
              format: config.format,
              containsPrivateKey: config.containsPrivateKey,
              passwordSecretRef,
              parameters: config.parameters,
              createdBy,
              tenantId,
            });
            ensured += 1;
          }
          continue;
        }
        await this.createFormat({
          tenantId,
          format: config.format,
          containsPrivateKey: config.containsPrivateKey,
          passwordSecretRef,
          parameters: config.parameters,
          createdBy,
        });
        ensured += 1;
      } catch (error) {
        console.warn(`[certificates] 默认证书产物配置文件补全失败 format=${config.format}`, error instanceof Error ? error.message : String(error));
      }
    }
    return { ensured };
  }

  /** 按默认配置的 configName 定位已有默认配置文件（不绑定证书版本的全局模板）。 */
  private async findDefaultFormatConfig(
    config: (typeof DEFAULT_FORMAT_CONFIGS)[number],
    tenantId?: string,
  ): Promise<CertificateVersionFormatEntity | undefined> {
    const configName = typeof config.parameters.configName === 'string' ? config.parameters.configName : '';
    if (!configName) return undefined;
    const page = await this.repository.listFormats({ page: 1, pageSize: 200, filter: {} }, tenantId);
    return page.items.find((item) => !item.certificateVersionId
      && item.format === config.format
      && readParameterString(item.parameters, 'configName') === configName);
  }

  /** PFX/JKS 规范要求设置密码，自动生成一个随机密码 Secret 供部署解析。 */
  private async createDefaultConfigPasswordSecret(
    config: (typeof DEFAULT_FORMAT_CONFIGS)[number],
    createdBy: string,
    tenantId?: string,
  ): Promise<string> {
    const created = await this.dependencies.secrets.create({
      tenantId,
      name: `默认导出密码 ${config.parameters.configName ?? config.format}`,
      type: 'pfx_password',
      scopeType: 'global',
      plainText: randomBytes(24).toString('base64url'),
      createdBy,
    });
    return created.secretRef;
  }

  /** 判断证书产物配置记录是否为宿主默认配置文件（模板），默认配置不允许删除。 */
  isDefaultFormatConfig(config: Pick<CertificateVersionFormatEntity, 'format' | 'containsPrivateKey' | 'parameters' | 'certificateVersionId'>): boolean {
    if (config.certificateVersionId) return false;
    return DEFAULT_FORMAT_CONFIGS.some((template) => template.format === config.format
      && template.containsPrivateKey === Boolean(config.containsPrivateKey)
      && buildCertificateFormatParameterHash({
        format: config.format,
        containsPrivateKey: Boolean(config.containsPrivateKey),
        passwordSecretRef: undefined,
        parameters: config.parameters ?? {},
      }) === buildCertificateFormatParameterHash({
        format: template.format,
        containsPrivateKey: template.containsPrivateKey,
        passwordSecretRef: undefined,
        parameters: template.parameters,
      }));
  }

  async updateFormat(input: UpdateCertificateVersionFormatInput, context?: RequestContext): Promise<CertificateVersionFormatDto> {
    const current = await this.repository.getFormat(input.id, input.tenantId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书产物配置不存在', { certificateVersionFormatId: input.id });
    }
    const certificateVersionId = input.certificateVersionId ?? current.certificateVersionId;
    const formatName = input.format ?? current.format;
    const containsPrivateKey = input.containsPrivateKey ?? current.containsPrivateKey;
    const passwordSecretRef = input.passwordSecretRef ?? current.passwordSecretRef;
    const parameters = input.parameters ?? current.parameters ?? {};
    const expiresAt = input.expiresAt ?? current.expiresAt;
    if (!certificateFormats.includes(formatName)) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', '证书格式不合法', { format: formatName });
    }
    if (certificateVersionId && !await this.repository.getVersion(certificateVersionId, input.tenantId)) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    this.assertPasswordSecretRef(formatName, passwordSecretRef);
    const parameterHash = buildCertificateFormatParameterHash({
      format: formatName,
      containsPrivateKey: Boolean(containsPrivateKey),
      passwordSecretRef,
      parameters,
    });
    const duplicated = certificateVersionId
      ? await this.repository.getFormatByNaturalKey(certificateVersionId, formatName, parameterHash, input.tenantId)
      : undefined;
    if (duplicated && duplicated.id !== current.id) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '已存在相同规则的证书产物配置', {
        duplicatedId: duplicated.id,
        certificateVersionId,
        format: formatName,
      });
    }
    const updated = await this.repository.updateFormat(current.id, {
      certificateVersionId,
      format: formatName,
      artifactRef: this.normalizeFormatConfigArtifactRef(undefined, formatName, parameters),
      parameterHash,
      parameters,
      containsPrivateKey: Boolean(containsPrivateKey),
      passwordSecretRef,
      createdBy: input.createdBy,
      expiresAt,
    }, input.tenantId);
    void this.dependencies.audit?.write({
      eventType: AUDIT_EVENT_TYPES.CERTIFICATE_IMPORTED,
      actorType: 'user',
      actorId: input.createdBy,
      action: 'certificate.format.update',
      resourceType: 'certificate_version_format',
      resourceId: updated.id,
      result: 'success',
      riskLevel: updated.containsPrivateKey ? 'high' : 'medium',
      context,
      detail: { certificateVersionId: updated.certificateVersionId, format: updated.format },
    });
    return toCertificateVersionFormatDto(updated);
  }

  async deleteFormat(input: DeleteCertificateVersionFormatInput, context?: RequestContext): Promise<CertificateVersionFormatDto> {
    const current = await this.repository.getFormat(input.id, input.tenantId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书产物配置不存在', { certificateVersionFormatId: input.id });
    }
    if (this.isDefaultFormatConfig(current)) {
      throw new AppError('DEFAULT_CERTIFICATE_FORMAT_PROTECTED', '宿主默认证书产物配置文件不允许删除', {
        format: current.format,
        certificateVersionFormatId: input.id,
      });
    }
    const deleted = await this.repository.deleteFormat(input.id, input.tenantId);
    void this.dependencies.audit?.write({
      eventType: AUDIT_EVENT_TYPES.CERTIFICATE_IMPORTED,
      actorType: 'user',
      actorId: input.deletedBy,
      action: 'certificate.format.delete',
      resourceType: 'certificate_version_format',
      resourceId: deleted.id,
      result: 'success',
      riskLevel: deleted.containsPrivateKey ? 'high' : 'medium',
      context,
      detail: { certificateVersionId: deleted.certificateVersionId, format: deleted.format },
    });
    return toCertificateVersionFormatDto(deleted);
  }

  private async buildChainCertificates(version: CertificateVersionEntity, tenantId?: string): Promise<CertificateVersionDetailDto['chainCertificates']> {
    const leaf = this.readCertificateSummary(Buffer.from(await this.readArtifact(version.leafStorageRef, tenantId ?? version.tenantId)));
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
      const certificate = this.readCertificateSummary(Buffer.from(await this.readArtifact(artifactRef, tenantId ?? version.tenantId)));
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

  async generateDeploymentArtifactFromFormat(input: {
    tenantId?: string;
    certificateVersionId: string;
    certificateFormatId: string;
    createdBy: string;
    expiresAt?: string;
  }, context?: RequestContext): Promise<{
    certificateVersionId: string;
    certificateFormatId: string;
    format: string;
    containsPrivateKey: boolean;
    certificatePem?: string;
    privateKeyPem?: string;
    pfxBase64?: string;
    pfxPassword?: string;
    files: CertificateArtifactFileDto[];
    warnings: string[];
  }> {
    const format = await this.repository.getFormat(input.certificateFormatId, input.tenantId);
    if (!format) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId: input.certificateFormatId });
    }
    const version = await this.repository.getVersion(input.certificateVersionId, input.tenantId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
    }
    const { generated, warnings, privateKey, password, pemNeedsSeparatePrivateKey } = await this.buildGeneratedFormatArtifact(format, version, input.createdBy, input.expiresAt, context, input.tenantId);
    console.info('[certificates.generateDeploymentArtifactFromFormat]', JSON.stringify({
      certificateVersionId: input.certificateVersionId,
      certificateFormatId: format.id,
      format: format.format,
      containsPrivateKey: format.containsPrivateKey,
      passwordSecretRef: format.passwordSecretRef,
      passwordLength: password?.plainText?.length,
      passwordUtf8Sha256: generated.debug?.passwordUtf8Sha256,
      passwordUtf8Length: generated.debug?.passwordUtf8Length,
      artifactSha256: createHash('sha256').update(generated.content).digest('hex'),
      artifactSize: generated.content.length,
      warnings: generated.warnings,
      parameterKeys: Object.keys(format.parameters ?? {}),
    }));
    return {
      certificateVersionId: input.certificateVersionId,
      certificateFormatId: format.id,
      format: generated.format,
      containsPrivateKey: format.containsPrivateKey,
      certificatePem: generated.format === 'pem' ? generated.content.toString('utf8') : undefined,
      privateKeyPem: generated.format === 'pem' && (format.containsPrivateKey || pemNeedsSeparatePrivateKey) ? privateKey?.plainText : undefined,
      pfxBase64: generated.format === 'pfx' ? generated.content.toString('base64') : undefined,
      pfxPassword: generated.format === 'pfx' ? password?.plainText : undefined,
      files: generated.files.map((file) => ({ ...file })),
      warnings: [...warnings, ...generated.warnings],
    };
  }

  async planFormatExport(input: CreateCertificateVersionFormatInput, context?: RequestContext): Promise<CertificateVersionFormatDto & { exportMode: 'planned'; artifactRef: string; warnings: string[] }> {
    if (!input.certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', 'certificateVersionId 不能为空');
    }
    const version = await this.getExistingVersion(input.certificateVersionId, input.tenantId);
    const warnings = this.validateFormatExportRequest(input as Required<Pick<CreateCertificateVersionFormatInput, 'certificateVersionId' | 'format' | 'createdBy'>> & CreateCertificateVersionFormatInput, version);
    const format = await this.createFormat(input);
    const entity = await this.repository.getFormat(format.id, input.tenantId);
    if (!entity) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId: format.id });
    }
    return { ...format, artifactRef: `artifact://certificate-format/${entity.id}/planned`, exportMode: 'planned', warnings };
  }

  async exportFormatArtifact(input: CreateCertificateVersionFormatInput, context?: RequestContext): Promise<CertificateVersionFormatDto & { exportMode: 'generated'; artifactRef: string; artifactSha256: string; artifactSize: number; warnings: string[] }> {
    if (!input.certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', 'certificateVersionId 不能为空');
    }
    const version = await this.getExistingVersion(input.certificateVersionId, input.tenantId);
    this.validateFormatExportRequest(input as Required<Pick<CreateCertificateVersionFormatInput, 'certificateVersionId' | 'format' | 'createdBy'>> & CreateCertificateVersionFormatInput, version);
    const formatDto = await this.createFormat(input);
    const format = await this.repository.getFormat(formatDto.id, input.tenantId);
    if (!format) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书格式配置不存在', { certificateFormatId: formatDto.id });
    }
    const { generated, warnings } = await this.buildGeneratedFormatArtifact(format, version, input.createdBy, input.expiresAt, context, input.tenantId);
    const artifactSha256 = createHash('sha256').update(generated.content).digest('hex');
    const artifactRef = `artifact://certificate-format/${format.id}/${artifactSha256}`;
    await this.artifacts.put({
      tenantId: input.tenantId,
      artifactRef,
      content: generated.content,
      contentType: generated.contentType,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt,
    });
    return {
      ...formatDto,
      artifactRef,
      exportMode: 'generated',
      artifactSha256,
      artifactSize: generated.content.length,
      warnings: [...warnings, ...generated.warnings],
    };
  }

  async syncFromSource(input: CertificateSourceSyncInput, context?: RequestContext): Promise<CertificateSourceSyncResult> {
    void context;
    throw new AppError('CA_CAPABILITY_UNSUPPORTED', '证书来源同步必须由 Plugin Runner 执行，宿主不提供厂商 CA 来源同步旁路', {
      operation: 'certificate_source_sync',
      sourceType: input.sourceType,
      implementation: 'controlled_error',
    });
  }

  private async getExistingVersion(id: string, tenantId?: string): Promise<CertificateVersionEntity> {
    const version = await this.repository.getVersion(id, tenantId);
    if (!version || version.status === 'deleted') {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: id });
    }
    return version;
  }

  private async buildGeneratedFormatArtifact(
    format: CertificateVersionFormatEntity,
    version: CertificateVersionEntity,
    actorId: string,
    expiresAt: string | undefined,
    context?: RequestContext,
    tenantId?: string,
  ): Promise<{
    generated: GeneratedCertificateFormatArtifact;
    warnings: string[];
    privateKey?: { plainText: string };
    password?: { plainText: string };
    pemNeedsSeparatePrivateKey: boolean;
  }> {
    const request = {
      certificateVersionId: version.id,
      format: format.format,
      containsPrivateKey: format.containsPrivateKey,
      passwordSecretRef: format.passwordSecretRef,
      parameters: { ...format.parameters },
      createdBy: actorId,
      expiresAt,
    };
    const warnings = this.validateFormatExportRequest(request, version);
    const pemNeedsSeparatePrivateKey = format.format === 'pem' && readBooleanParameter(format.parameters, 'generatePrivateKeyFile');
    const privateKey = (format.containsPrivateKey || pemNeedsSeparatePrivateKey)
      ? await this.resolveSecret(version.privateKeySecretRef, version.tenantId, 'certificate_private_key', 'certificate.deployment.private_key', actorId, context)
      : undefined;
    const password = format.passwordSecretRef
      ? await this.resolveSecret(format.passwordSecretRef, version.tenantId, 'pfx_password', 'certificate.deployment.password', actorId, context)
      : undefined;
    const exporter = format.format === 'pfx' ? this.pfxExporter : this.exporter;
    if (!exporter) {
      throw new AppError('CERT_FORMAT_UNSUPPORTED', 'PFX 当前必须通过 Plugin Runner 处理，宿主未注册生产插件', { format: 'pfx' });
    }
    const generated = exporter.generate(format.format, {
      version,
      leafDer: await this.readArtifact(version.leafStorageRef, tenantId ?? version.tenantId),
      chainDer: await Promise.all(version.chainCertificateRefs.map((artifactRef) => this.readArtifact(artifactRef, tenantId ?? version.tenantId))),
      privateKeyPem: privateKey?.plainText,
      password: password?.plainText,
      parameters: { ...format.parameters },
    });
    return { generated, warnings, privateKey, password, pemNeedsSeparatePrivateKey };
  }

  private validateFormatExportRequest(input: {
    certificateVersionId: string;
    format: typeof certificateFormats[number];
    containsPrivateKey?: boolean;
    passwordSecretRef?: string;
    parameters?: Record<string, unknown>;
    createdBy: string;
    expiresAt?: string;
  }, version: CertificateVersionEntity): string[] {
    const warnings: string[] = [];
    if (!certificateFormats.includes(input.format)) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', '证书格式不合法', { format: input.format });
    }
    if (input.format === 'p7b' || (input.format === 'pfx' && !this.pfxExporter)) {
      throw new AppError('CERT_FORMAT_UNSUPPORTED', `${input.format.toUpperCase()} 当前必须通过 Plugin Runner 处理，宿主未注册生产插件`, { format: input.format });
    }
    if (input.format === 'der' && input.containsPrivateKey) {
      throw new AppError('CERT_EXPORT_FORMAT_INVALID', 'DER 格式不能包含私钥', { format: input.format });
    }
    if (input.format === 'jks' && !input.containsPrivateKey) {
      throw new AppError('VALIDATION_FAILED', 'JKS 导出必须包含私钥', { format: input.format });
    }
    if (input.containsPrivateKey && !version.privateKeySecretRef) {
      throw new AppError('VALIDATION_FAILED', '证书版本没有私钥 SecretRef，不能导出包含私钥的格式', { certificateVersionId: input.certificateVersionId });
    }
    if (input.format === 'jks' && !input.passwordSecretRef) {
      throw new AppError('VALIDATION_FAILED', 'JKS 导出必须提供 passwordSecretRef', { format: input.format });
    }
    this.assertPasswordSecretRef(input.format, input.passwordSecretRef);
    if (version.chainStatus !== 'valid') {
      warnings.push(`证书链状态为 ${version.chainStatus}，导出产物只可用于修复或人工确认场景`);
    }
    return warnings;
  }

  private assertPasswordSecretRef(format: typeof certificateFormats[number], passwordSecretRef: string | undefined): void {
    if (format !== 'jks') {
      return;
    }
    if (!passwordSecretRef) {
      return;
    }
    if (!/^secret:\/\/[a-z0-9_/-]+(?:#[a-z0-9_-]+)?$/i.test(passwordSecretRef.trim())) {
      throw new AppError('SECRET_REF_INVALID', 'JKS 配置中的 passwordSecretRef 不是合法 Secret 引用', {
        format,
        passwordSecretRef,
      });
    }
  }

  private async readArtifact(artifactRef: string, tenantId?: string): Promise<Buffer> {
    const artifact = await this.artifacts.get(artifactRef, tenantId);
    if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', '证书材料产物不存在，无法导出格式', { artifactRef });
    return artifact.content;
  }

  private async resolveSecret(
    secretRef: string | undefined,
    tenantId: string | undefined,
    expectedType: Parameters<SecretService['resolveForService']>[0]['expectedType'],
    purpose: string,
    actorId: string,
    context?: RequestContext,
  ) {
    if (!secretRef) return undefined;
    try {
      return await this.dependencies.secrets.resolveForService({ secretRef, tenantId, expectedType, purpose, actorId, context });
    } catch (error) {
      if (error instanceof SecurityError && error.errorCode === 'SEC_SECRET_RESOLVE_DENIED') {
        throw new AppError(
          'VALIDATION_FAILED',
          '证书导出依赖的 Secret 无法解密，请重新导入对应私钥或重建导出密码 Secret',
          { secretRef, expectedType, purpose, reason: error.details?.reason },
        );
      }
      throw error;
    }
  }

  private async changeAssetStatus(input: ChangeCertificateAssetStatusInput, context?: RequestContext): Promise<CertificateAssetEntity> {
    const asset = await this.getExistingAsset(input.id, input.tenantId);
    const updated = await this.repository.deleteOrUpdateAsset(asset.id, { status: input.status, updatedAt: new Date().toISOString() }, input.tenantId);
    void this.writeLifecycleAudit('certificate.asset.status', 'certificate_asset', updated.id, input.actorId, input.status, context);
    return updated;
  }

  private async changeVersionStatus(input: ChangeCertificateVersionStatusInput, context?: RequestContext): Promise<CertificateVersionEntity> {
    const version = await this.getExistingVersion(input.id, input.tenantId);
    const updated = await this.repository.deleteOrUpdateVersion(version.id, { status: input.status, deployable: input.status === 'active' ? version.deployable : false }, input.tenantId);
    if (input.status === 'deleted') {
      const asset = await this.repository.getAsset(updated.certificateAssetId, input.tenantId);
      if (asset?.currentVersionId === updated.id) {
        const replacement = (await this.repository.listVersionsByAsset(asset.id, input.tenantId)).find((candidate) => candidate.id !== updated.id && candidate.status === 'active');
        await this.repository.updateAsset(asset.id, { currentVersionId: replacement?.id, updatedAt: new Date().toISOString() }, input.tenantId);
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

  private async getExistingAsset(id: string, tenantId?: string): Promise<CertificateAssetEntity> {
    const asset = await this.repository.getAsset(id, tenantId);
    if (!asset || asset.status === 'deleted') {
      throw new AppError('RESOURCE_NOT_FOUND', '证书资产不存在', { certificateAssetId: id });
    }
    return asset;
  }

  private assertImportableChain(importable: boolean, blockers: string[]): void {
    if (!importable) {
      throw new AppError('CERT_PARSE_FAILED', blockers[0] ?? '证书材料不可导入', { blockers });
    }
  }

  private async createAssetFromParsed(input: ImportCertificateVersionInput, commonName: string | undefined, sans: string[]): Promise<CertificateAssetEntity> {
    const primaryDomain = normalizeCertificateDomain(commonName ?? sans[0]);
    if (!primaryDomain) {
      throw new AppError('CERT_PARSE_FAILED', '证书缺少 commonName 和 SAN，无法创建逻辑资产');
    }
    const existing = await this.repository.findAssetByPrimaryDomain(primaryDomain, input.tenantId);
    if (existing) {
      const updated = await this.repository.updateAsset(existing.id, {
        sans: uniqueStrings([...existing.sans, ...sans.map(normalizeCertificateDomain)]),
        tags: uniqueStrings([...existing.tags, ...(input.tags ?? [])]),
        updatedAt: new Date().toISOString(),
      }, input.tenantId);
      return updated;
    }
    const created = await this.createAsset({
      name: input.name ?? primaryDomain,
      primaryDomain,
      sans,
      sourceType: input.sourceType,
      tags: input.tags,
      tenantId: input.tenantId,
      createdBy: input.createdBy,
    });
    return this.getExistingAsset(created.id, input.tenantId);
  }

  private normalizeFormatConfigArtifactRef(
    artifactRef: string | undefined,
    format: string,
    parameters: Record<string, unknown> | undefined,
  ): string {
    const trimmed = artifactRef?.trim();
    if (trimmed) return trimmed;
    const parameterHash = buildCertificateFormatParameterHash({
      format,
      containsPrivateKey: false,
      parameters: parameters ?? {},
    }).slice(0, 16);
    return `artifact://certificate-format-config/${format}/${parameterHash}`;
  }
}

export function hashCertificateMaterial(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeCertificateDomain(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function readBooleanParameter(parameters: Record<string, unknown> | undefined, key: string): boolean {
  const value = parameters?.[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return false;
}

function readParameterString(parameters: Record<string, unknown> | undefined, key: string): string {
  const value = parameters?.[key];
  return typeof value === 'string' ? value : '';
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
