import { X509Certificate } from 'node:crypto';
import { AppError } from '../../../../common/errors/app-error.js';
import type { PageQuery } from '../../../../common/pagination/pagination.js';
import type { PageResponse } from '../../../../shared/dto/page-response.js';
import { newId } from '../../../../shared/id.js';
import type { DatabasePort } from '../../../../database/database-port.js';
import { PgliteDatabase } from '../../../../database/pglite-database.js';
import type { CertificateArtifactStore } from '../../artifacts/certificate-artifact-store.js';
import { PgCertificateArtifactStore } from '../../artifacts/certificate-artifact-store.js';
import type { ParsedCertificate, ParsedMaterialBundle } from '../../domain/certificates.domain-service.js';
import type { CertificateVersionEntity, CertificateDistinguishedName } from '../../schema/certificates.schema.js';
import type { CertificatesRepository } from '../../repository/certificates.repository.js';
import { PgCertificatesRepository } from '../../repository/certificates.repository.js';
import type {
  DiscoverRootCertificateInput,
  DiscoverRootCertificateResult,
  ImportRootCertificateInput,
  ManagedCertificateTrustRootStatusDto,
  ManagedCertificateTrustRootSummaryDto,
  RootCertificateListPageDto,
  RootCertificateDetailDto,
  RootCertificateRecordDto,
} from '../dto/trust-roots.dto.js';
import {
  toCertificateVersionTrustRootDto,
  toRootCertificateRecordDto,
  toRootCertificateSourceObservationDto,
} from '../dto/trust-roots.dto.js';
import type {
  CertificateVersionTrustRootEntity,
  RootCertificateRecordEntity,
  RootCertificateSourceType,
} from '../schema/trust-roots.schema.js';
import { PgTrustRootsRepository, type TrustRootsRepository } from '../repository/trust-roots.repository.js';

const CERT_BLOCK_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
const MANAGED_CERTIFICATE_ROOT_PROJECTION_ACTOR = 'system_managed_certificate_root_projection';

export interface TrustRootsApplicationDependencies {
  db?: DatabasePort;
  repository?: TrustRootsRepository;
  certificates?: CertificatesRepository;
  artifacts?: CertificateArtifactStore;
}

export class TrustRootsApplicationService {
  private readonly db: DatabasePort;
  private readonly repository: TrustRootsRepository;
  private readonly certificates: CertificatesRepository;
  private readonly artifacts: CertificateArtifactStore;

  constructor(dependencies: TrustRootsApplicationDependencies = {}) {
    this.db = dependencies.db ?? new PgliteDatabase();
    this.repository = dependencies.repository ?? new PgTrustRootsRepository(this.db);
    this.certificates = dependencies.certificates ?? new PgCertificatesRepository(this.db);
    this.artifacts = dependencies.artifacts ?? new PgCertificateArtifactStore(this.db);
  }

  async listRoots(query: PageQuery): Promise<RootCertificateListPageDto> {
    await this.backfillRootsFromManagedCertificates(MANAGED_CERTIFICATE_ROOT_PROJECTION_ACTOR);
    const [page, managedSummary] = await Promise.all([
      this.repository.listRoots(query),
      this.buildManagedCertificateRootSummary(),
    ]);
    return {
      ...page,
      items: page.items.map(toRootCertificateRecordDto),
      managedSummary,
    };
  }

  async getRootDetail(id: string, tenantId?: string): Promise<RootCertificateDetailDto> {
    const root = await this.repository.getRoot(id);
    if (!root) throw new AppError('RESOURCE_NOT_FOUND', '根证书不存在', { rootCertificateId: id });
    const [observations, relations] = await Promise.all([
      this.repository.listObservationsByRoot(root.id),
      this.repository.listRelationsByRoot(root.id, tenantId),
    ]);
    return {
      ...toRootCertificateRecordDto(root),
      observations: observations.map(toRootCertificateSourceObservationDto),
      versionRelations: relations.map(toCertificateVersionTrustRootDto),
    };
  }

  async getVersionTrustRoots(certificateVersionId: string, tenantId?: string): Promise<Array<{
    relation: CertificateVersionTrustRootEntity['relation'];
    resolutionStatus: CertificateVersionTrustRootEntity['resolutionStatus'];
    selectionReason?: string;
    root: RootCertificateRecordDto;
  }>> {
    const version = await this.certificates.getVersion(certificateVersionId, tenantId);
    if (version) {
      await this.backfillManagedVersionRoot(version, MANAGED_CERTIFICATE_ROOT_PROJECTION_ACTOR);
    }
    const relations = await this.repository.listVersionTrustRoots(certificateVersionId, tenantId);
    const items = await Promise.all(relations.map(async (relation) => {
      const root = await this.repository.getRoot(relation.rootCertificateId);
      return root ? {
        relation: relation.relation,
        resolutionStatus: relation.resolutionStatus,
        selectionReason: relation.selectionReason,
        root: toRootCertificateRecordDto(root),
      } : undefined;
    }));
    return items.filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  async resolveVersionInstallableRoot(
    certificateVersionId: string,
    tenantId?: string,
    createdBy?: string,
  ): Promise<{ root: RootCertificateRecordDto; certificatePem: string } | undefined> {
    const selected = await this.selectVersionInstallableRoot(certificateVersionId, tenantId);
    void createdBy;
    const resolved = selected ?? await this.selectVersionInstallableRoot(certificateVersionId, tenantId);
    if (!resolved) return undefined;
    // 项目根证书是公共证书材料，历史版本可能按默认租户保存；优先使用当前租户，
    // 找不到时再读取公共记录，避免材料租户迁移导致已验证根证书失效。
    const artifact = await this.artifacts.get(resolved.root.certificateArtifactRef, tenantId)
      ?? await this.artifacts.get(resolved.root.certificateArtifactRef);
    if (!artifact) {
      throw new AppError('RESOURCE_NOT_FOUND', '根证书产物不存在，不能生成安装材料', {
        certificateVersionId,
        rootCertificateId: resolved.root.id,
        artifactRef: resolved.root.certificateArtifactRef,
      });
    }
    return {
      root: resolved.root,
      certificatePem: artifact.contentType === 'application/x-pem-file'
        ? artifact.content.toString('utf8')
        : derToPem(artifact.content),
    };
  }

  async importRoot(input: ImportRootCertificateInput): Promise<RootCertificateRecordDto> {
    const candidate = this.parseInputCertificate(input.certificatePem, input.certificateDerBase64);
    if (!candidate.ca) {
      throw new AppError('CERT_PARSE_FAILED', '导入材料不是有效的 CA 根证书', {
        fingerprintSha256: candidate.fingerprintSha256,
      });
    }
    const root = await this.upsertRoot(candidate, input.createdBy, input.tenantId);
    await this.repository.createObservation({
      id: newId('rootobs'),
      rootCertificateId: root.id,
      sourceType: 'manual',
      sourceRef: input.sourceRef,
      observedFingerprint: root.fingerprintSha256,
      observedAt: new Date().toISOString(),
      status: 'accepted',
    });
    if (input.certificateVersionId) {
      const version = await this.certificates.getVersion(input.certificateVersionId, input.tenantId);
      if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: input.certificateVersionId });
      await this.attachVersionRoot(version, root, 'selected_root', 'resolved', 'manual_import');
    }
    return toRootCertificateRecordDto(root);
  }

  async discoverRoot(input: DiscoverRootCertificateInput): Promise<DiscoverRootCertificateResult> {
    const fingerprint = await this.resolveTargetFingerprint(input);
    if (!fingerprint) {
      throw new AppError('RESOURCE_NOT_FOUND', '无法确定目标根证书指纹', {
        certificateVersionId: input.certificateVersionId,
      });
    }
    const existing = await this.repository.getRootByFingerprint(fingerprint);
    if (existing) {
      return { fingerprintSha256: fingerprint, root: toRootCertificateRecordDto(existing), status: 'found' };
    }
    void input.allowedSources;
    void input.createdBy;
    return {
      fingerprintSha256: fingerprint,
      status: 'failed',
      failureCode: 'CA_CAPABILITY_UNSUPPORTED',
    };
  }

  async syncImportedVersionRoot(version: CertificateVersionEntity, bundle: ParsedMaterialBundle, actorId: string): Promise<void> {
    const rootCandidate = resolveBundleRoot(bundle);
    if (!rootCandidate) return;
    await this.persistManagedVersionRoot(version, rootCandidate, actorId, 'import_chain_root');
  }

  private async backfillRootsFromManagedCertificates(createdBy: string): Promise<void> {
    const pageSize = 200;
    for (let page = 1; ; page += 1) {
      const versions = await this.certificates.listVersions({ page, pageSize, filter: {} });
      for (const version of versions.items) {
        await this.backfillManagedVersionRoot(version, createdBy);
      }
      if (versions.items.length < pageSize) return;
    }
  }

  private async buildManagedCertificateRootSummary(): Promise<ManagedCertificateTrustRootSummaryDto> {
    const versions = await this.listAllManagedVersions();
    const items = (await Promise.all(versions.map(async (version) => this.buildManagedCertificateRootStatus(version))))
      .filter((item): item is ManagedCertificateTrustRootStatusDto => Boolean(item));
    return {
      totalVersions: items.length,
      resolvedVersions: items.filter((item) => item.rootStatus === 'resolved').length,
      missingVersions: items.filter((item) => item.rootStatus === 'missing').length,
      invalidChainVersions: items.filter((item) => item.rootStatus === 'invalid_chain').length,
      rootsInLibrary: new Set(items.map((item) => item.rootCertificateId).filter(Boolean)).size,
      items,
    };
  }

  private async buildManagedCertificateRootStatus(
    version: CertificateVersionEntity,
  ): Promise<ManagedCertificateTrustRootStatusDto | undefined> {
    const relations = await this.repository.listVersionTrustRoots(version.id, version.tenantId);
    const selectedRelation = relations.find((item) => item.relation === 'selected_root') ?? relations[0];
    const root = selectedRelation ? await this.repository.getRoot(selectedRelation.rootCertificateId) : undefined;
    const chainStatus = version.chainStatus;
    const rootFingerprintSha256 = root?.fingerprintSha256
      ?? normalizeFingerprint(version.chainOrder.at(-1));
    const rootStatus = root && selectedRelation?.resolutionStatus === 'resolved'
      ? 'resolved'
      : chainStatus === 'invalid'
        ? 'invalid_chain'
        : 'missing';
    return {
      certificateVersionId: version.id,
      certificateAssetId: version.certificateAssetId,
      certificateName: version.commonName?.trim() || version.subject.commonName?.trim() || version.fingerprintSha256,
      fingerprintSha256: version.fingerprintSha256,
      chainStatus,
      rootStatus,
      rootFingerprintSha256,
      rootCertificateId: root?.id,
      rootValidationStatus: root?.validationStatus,
      relation: selectedRelation?.relation,
      selectionReason: selectedRelation?.selectionReason,
    };
  }

  private async listAllManagedVersions(): Promise<CertificateVersionEntity[]> {
    const results: CertificateVersionEntity[] = [];
    const pageSize = 200;
    for (let page = 1; ; page += 1) {
      const current = await this.certificates.listVersions({ page, pageSize, filter: {} });
      results.push(...current.items);
      if (current.items.length < pageSize) return results;
    }
  }

  private async backfillManagedVersionRoot(version: CertificateVersionEntity, createdBy: string): Promise<void> {
    const existingRelations = await this.repository.listVersionTrustRoots(version.id, version.tenantId);
    if (existingRelations.some((relation) => relation.relation === 'selected_root' && relation.resolutionStatus === 'resolved')) {
      return;
    }
    if (version.chainStatus === 'incomplete') {
      const candidate = await this.resolveManagedVersionRootFromLibrary(version);
      if (candidate) {
        await this.attachVersionRoot(version, candidate, 'selected_root', 'resolved', 'backfill_root_library');
      }
      return;
    }
    if (version.chainStatus !== 'valid') return;
    const rootFingerprint = normalizeFingerprint(version.chainOrder.at(-1));
    if (!rootFingerprint) return;
    const existingRoot = await this.repository.getRootByFingerprint(rootFingerprint);
    if (existingRoot) {
      await this.attachVersionRoot(version, existingRoot, 'selected_root', 'resolved', 'backfill_existing_root');
      return;
    }
    const candidate = await this.resolveManagedVersionRootCandidate(version, rootFingerprint);
    if (candidate) {
      await this.persistManagedVersionRoot(version, candidate, createdBy, 'backfill_managed_certificate');
      return;
    }
    void createdBy;
  }

  private async resolveManagedVersionRootCandidate(
    version: CertificateVersionEntity,
    rootFingerprint: string,
  ): Promise<ParsedRootCandidate | undefined> {
    const artifactRefs = [...version.chainCertificateRefs];
    if (rootFingerprint === normalizeFingerprint(version.fingerprintSha256)) {
      artifactRefs.push(version.leafStorageRef);
    }
    for (const artifactRef of artifactRefs) {
      const artifact = await this.artifacts.get(artifactRef, version.tenantId);
      if (!artifact) continue;
      try {
        const candidate = parseCertificateCandidateFromDer(artifact.content);
        if (candidate.fingerprintSha256 !== rootFingerprint) continue;
        if (!candidate.ca || candidate.subject.raw !== candidate.issuer.raw) continue;
        return candidate;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private async resolveManagedVersionRootFromLibrary(
    version: CertificateVersionEntity,
  ): Promise<RootCertificateRecordEntity | undefined> {
    const tailFingerprint = normalizeFingerprint(version.chainOrder.at(-1));
    if (!tailFingerprint) return undefined;
    const tail = await this.readManagedVersionCertificate(version, tailFingerprint);
    if (!tail || !tail.ca || tail.subject.raw === tail.issuer.raw) return undefined;
    const roots = await this.repository.listRootsBySubject(tail.issuer.raw);
    const matches: RootCertificateRecordEntity[] = [];
    for (const root of roots) {
      if (root.validationStatus !== 'verified' || !root.basicConstraints.ca) continue;
      const artifact = await this.artifacts.get(root.certificateArtifactRef, version.tenantId)
        ?? await this.artifacts.get(root.certificateArtifactRef);
      if (!artifact) continue;
      try {
        const certificate = new X509Certificate(artifact.content);
        if (normalizeFingerprint(certificate.fingerprint256.replaceAll(':', '')) !== normalizeFingerprint(root.fingerprintSha256)) continue;
        if (certificate.subject !== certificate.issuer || !tail.x509.verify(certificate.publicKey)) continue;
        matches.push(root);
      } catch {
        continue;
      }
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  private async readManagedVersionCertificate(
    version: CertificateVersionEntity,
    fingerprintSha256: string,
  ): Promise<{ x509: X509Certificate; ca: boolean; subject: CertificateDistinguishedName; issuer: CertificateDistinguishedName } | undefined> {
    for (const artifactRef of [version.leafStorageRef, ...version.chainCertificateRefs]) {
      const artifact = await this.artifacts.get(artifactRef, version.tenantId);
      if (!artifact) continue;
      try {
        const x509 = new X509Certificate(artifact.content);
        if (normalizeFingerprint(x509.fingerprint256.replaceAll(':', '')) !== fingerprintSha256) continue;
        return { x509, ca: x509.ca, subject: parseDistinguishedName(x509.subject), issuer: parseDistinguishedName(x509.issuer) };
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private async persistManagedVersionRoot(
    version: CertificateVersionEntity,
    rootCandidate: ParsedRootCandidate,
    actorId: string,
    selectionReason: string,
    observation?: {
      sourceType: RootCertificateSourceType;
      sourceRef?: string;
    },
  ): Promise<void> {
    const root = await this.upsertRoot(rootCandidate, actorId, version.tenantId);
    await this.recordRootObservation(
      root.id,
      observation?.sourceType ?? 'manual',
      observation?.sourceRef ?? `certificate_version:${version.id}`,
      root.fingerprintSha256,
    );
    await this.attachVersionRoot(version, root, 'selected_root', 'resolved', selectionReason);
  }

  private async recordRootObservation(
    rootCertificateId: string,
    sourceType: RootCertificateSourceType,
    sourceRef?: string,
    observedFingerprint?: string,
  ): Promise<void> {
    await this.repository.createObservation({
      id: newId('rootobs'),
      rootCertificateId,
      sourceType,
      sourceRef,
      observedFingerprint: observedFingerprint ?? sourceRef ?? sourceType,
      observedAt: new Date().toISOString(),
      status: 'accepted',
    });
  }

  private async resolveTargetFingerprint(input: DiscoverRootCertificateInput): Promise<string | undefined> {
    const explicit = normalizeFingerprint(input.fingerprintSha256);
    if (explicit) return explicit;
    if (!input.certificateVersionId) return undefined;
    const relations = await this.repository.listVersionTrustRoots(input.certificateVersionId, input.tenantId);
    if (relations.length > 0) {
      const root = await this.repository.getRoot(relations[0]!.rootCertificateId);
      return root?.fingerprintSha256;
    }
    const version = await this.certificates.getVersion(input.certificateVersionId, input.tenantId);
    if (!version || version.chainOrder.length === 0) return undefined;
    return normalizeFingerprint(version.chainOrder.at(-1));
  }

  private async upsertRoot(candidate: ParsedRootCandidate, createdBy: string, tenantId?: string): Promise<RootCertificateRecordEntity> {
    const now = new Date().toISOString();
    const artifactRef = `artifact://trust-root/${candidate.fingerprintSha256}`;
    await this.artifacts.put({
      tenantId,
      artifactRef,
      content: candidate.der,
      contentType: 'application/pkix-cert',
      createdBy,
    });
    const existing = await this.repository.getRootByFingerprint(candidate.fingerprintSha256);
    return this.repository.createOrUpdateRoot({
      id: existing?.id ?? newId('trustroot'),
      fingerprintSha256: candidate.fingerprintSha256,
      certificateArtifactRef: artifactRef,
      subject: candidate.subject,
      issuer: candidate.issuer,
      serialNumber: candidate.serialNumber,
      notBefore: candidate.notBefore,
      notAfter: candidate.notAfter,
      basicConstraints: { ca: candidate.ca },
      validationStatus: candidate.ca ? 'verified' : 'rejected',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private async attachVersionRoot(
    version: CertificateVersionEntity,
    root: RootCertificateRecordEntity,
    relation: CertificateVersionTrustRootEntity['relation'],
    resolutionStatus: CertificateVersionTrustRootEntity['resolutionStatus'],
    selectionReason: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.repository.upsertVersionTrustRoot({
      id: newId('vertrustroot'),
      tenantId: version.tenantId,
      certificateVersionId: version.id,
      rootCertificateId: root.id,
      relation,
      chainPath: [...version.chainOrder],
      selectionReason,
      resolutionStatus,
      createdAt: now,
      updatedAt: now,
    });
  }

  private parseInputCertificate(certificatePem?: string, certificateDerBase64?: string): ParsedRootCandidate {
    if (typeof certificatePem === 'string' && certificatePem.trim()) return parseCertificateCandidateFromPem(certificatePem);
    if (typeof certificateDerBase64 === 'string' && certificateDerBase64.trim()) return parseCertificateCandidateFromDer(Buffer.from(certificateDerBase64, 'base64'));
    throw new AppError('VALIDATION_FAILED', 'certificatePem 或 certificateDerBase64 至少提供一个');
  }

  private async selectVersionInstallableRoot(
    certificateVersionId: string,
    tenantId?: string,
  ): Promise<{ relation: CertificateVersionTrustRootEntity['relation']; root: RootCertificateRecordDto } | undefined> {
    const relations = await this.getVersionTrustRoots(certificateVersionId, tenantId);
    return relations.find((item) => item.resolutionStatus === 'resolved'
      && item.root.validationStatus === 'verified'
      && item.relation === 'selected_root')
      ?? relations.find((item) => item.resolutionStatus === 'resolved' && item.root.validationStatus === 'verified');
  }
}

type ParsedRootCandidate = Pick<RootCertificateRecordEntity, 'fingerprintSha256' | 'subject' | 'issuer' | 'serialNumber' | 'notBefore' | 'notAfter'> & {
  der: Buffer;
  pem: string;
  ca: boolean;
};

function parseCertificateCandidateFromPem(pemText: string): ParsedRootCandidate {
  const match = pemText.match(CERT_BLOCK_PATTERN)?.[0];
  if (!match) throw new AppError('CERT_PARSE_FAILED', '证书 PEM 格式不合法');
  const certificate = new X509Certificate(match);
  return toCandidate(certificate);
}

function parseCertificateCandidateFromDer(der: Buffer): ParsedRootCandidate {
  return toCandidate(new X509Certificate(der));
}

function toCandidate(certificate: X509Certificate): ParsedRootCandidate {
  return {
    der: certificate.raw,
    pem: certificate.toString(),
    fingerprintSha256: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
    subject: parseDistinguishedName(certificate.subject),
    issuer: parseDistinguishedName(certificate.issuer),
    serialNumber: certificate.serialNumber,
    notBefore: new Date(certificate.validFrom).toISOString(),
    notAfter: new Date(certificate.validTo).toISOString(),
    ca: certificate.ca,
  };
}

function resolveBundleRoot(bundle: ParsedMaterialBundle): ParsedRootCandidate | undefined {
  if (bundle.chainStatus !== 'valid') return undefined;
  const rootFingerprint = bundle.chainOrder.at(-1);
  if (!rootFingerprint) return undefined;
  const root = bundle.certificates.find((certificate) => certificate.fingerprintSha256 === rootFingerprint);
  if (!root || root.subject.raw !== root.issuer.raw || !root.x509.ca) return undefined;
  return parsedCertificateToCandidate(root);
}

function parsedCertificateToCandidate(certificate: ParsedCertificate): ParsedRootCandidate {
  return {
    der: certificate.der,
    pem: certificate.pem,
    fingerprintSha256: certificate.fingerprintSha256,
    subject: certificate.subject,
    issuer: certificate.issuer,
    serialNumber: certificate.serialNumber,
    notBefore: certificate.notBefore,
    notAfter: certificate.notAfter,
    ca: certificate.x509.ca,
  };
}

function derToPem(der: Buffer): string {
  return new X509Certificate(der).toString();
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

function normalizeFingerprint(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined;
}
