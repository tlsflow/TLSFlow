import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';
import type { InternalCaApplicationService, CreateCertificateRequestInput } from './internal-ca.application-service.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { CertificateRotationEntity } from '../schema/internal-ca.schema.js';

export interface CreateCertificateRotationInput {
  tenantId: string;
  applicationAssetId: string;
  sourceCertificateVersionId: string;
  custodyMode?: CreateCertificateRequestInput['custodyMode'];
  csrPem?: string;
  opaqueKeyReference?: string;
  keyBackend?: CreateCertificateRequestInput['keyBackend'];
  exportability?: CreateCertificateRequestInput['exportability'];
  requestedKeyAlgorithm?: CreateCertificateRequestInput['requestedKeyAlgorithm'];
  idempotencyKey: string;
  actorId: string;
  context?: RequestContext;
}

/**
 * 证书生命周期的最小闭环：创建新密钥申请、等待/完成签发、生成精确安装输入，
 * TLS 验证成功后才提交旧版本撤销。远程写入仍由 Agent/DeploymentPlan 执行。
 */
export class CertificateLifecycleService {
  constructor(
    private readonly dependencies: {
      internalCa: InternalCaApplicationService;
      certificates: CertificatesApplicationService;
      repository: InternalCaRepository;
    },
  ) {}

  async createRotation(input: CreateCertificateRotationInput): Promise<CertificateRotationEntity> {
    const existing = await this.dependencies.repository.getRotationByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (existing) return existing;
    const source = await this.requireVersion(input.tenantId, input.sourceCertificateVersionId);
    const sourceRequest = source.certificateRequestId
      ? (await this.dependencies.internalCa.listRequests(input.tenantId)).find((item) => item.id === source.certificateRequestId)
      : undefined;
    const sourceBelongsToApplication = sourceRequest
      ? sourceRequest.applicationAssetId === input.applicationAssetId
      : source.certificateAssetId === input.applicationAssetId;
    if (!sourceBelongsToApplication) throw new AppError('TENANT_SCOPE_DENIED', '轮换源证书不属于指定应用资产');
    if (!source.issuingCaId || !source.certificateProfileVersionId) throw new AppError('RESOURCE_VERSION_CONFLICT', '源证书缺少签发 CA 或 Profile 版本，不能自动轮换');
    const sourceKey = source.keyReferenceId ? await this.dependencies.repository.getKeyReference(input.tenantId, source.keyReferenceId) : undefined;
    const now = new Date().toISOString();
    let rotation: CertificateRotationEntity = {
      id: newId('rotation'), tenantId: input.tenantId, applicationAssetId: input.applicationAssetId,
      sourceCertificateVersionId: source.id, sourceKeyReferenceId: source.keyReferenceId,
      policyVersionId: undefined, idempotencyKey: input.idempotencyKey, status: 'requested',
      evidence: { sourcePublicKeyFingerprintSha256: source.publicKeyFingerprintSha256 }, warnings: [], requestedBy: input.actorId,
      createdAt: now, updatedAt: now,
    };
    rotation = await this.dependencies.repository.saveRotation(rotation);
    try {
      const custodyMode = input.custodyMode ?? source.keyCustodyMode ?? 'managed_secret';
      if (custodyMode !== 'managed_secret' && (!input.csrPem || !input.opaqueKeyReference)) {
        return this.dependencies.repository.saveRotation({ ...rotation, status: 'key_csr_pending', updatedAt: new Date().toISOString() });
      }
      const request = await this.dependencies.internalCa.createCertificateRequest(input.tenantId, {
        applicationAssetId: input.applicationAssetId,
        caId: source.issuingCaId,
        profileVersionId: source.certificateProfileVersionId,
        commonName: source.commonName ?? source.subject.commonName ?? input.applicationAssetId,
        sans: source.sans,
        requestedValidityDays: Math.max(1, Math.ceil((Date.parse(source.notAfter) - Date.now()) / 86_400_000)),
        custodyMode,
        csrPem: input.csrPem,
        opaqueKeyReference: input.opaqueKeyReference,
        keyBackend: input.keyBackend,
        exportability: input.exportability,
        requestedKeyAlgorithm: input.requestedKeyAlgorithm,
        idempotencyKey: `rotation-request:${input.idempotencyKey}`,
        actorId: input.actorId,
        deferIssuance: false,
      }, input.context);
      const targetKey = await this.dependencies.repository.getKeyReference(input.tenantId, request.keyReferenceId);
      if (sourceKey && targetKey && sourceKey.id === targetKey.id) throw new AppError('PUBLIC_KEY_MISMATCH', '轮换不能复用源密钥引用');
      if (targetKey && source.publicKeyFingerprintSha256 && targetKey.publicKeyFingerprintSha256.toLowerCase() === source.publicKeyFingerprintSha256.toLowerCase()) throw new AppError('PUBLIC_KEY_MISMATCH', '轮换生成了与源证书相同的公钥');
      const status: CertificateRotationEntity['status'] = request.status === 'issued' ? 'install_pending' : request.status === 'issuing' ? 'issuing' : 'key_csr_pending';
      return this.dependencies.repository.saveRotation({
        ...rotation, status, targetKeyReferenceId: request.keyReferenceId, targetCertificateRequestId: request.id,
        policyVersionId: request.certificatePolicyVersionId, targetCertificateVersionId: request.certificateVersionId,
        evidence: { ...rotation.evidence, targetPublicKeyFingerprintSha256: targetKey?.publicKeyFingerprintSha256, targetRequestStatus: request.status }, updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const status: CertificateRotationEntity['status'] = error instanceof AppError && error.errorCode === 'CA_PROVIDER_UNAVAILABLE' ? 'unknown' : 'failed';
      return this.dependencies.repository.saveRotation({ ...rotation, status, warnings: [error instanceof Error ? error.message : String(error)], updatedAt: new Date().toISOString() });
    }
  }

  async listRotations(tenantId: string): Promise<CertificateRotationEntity[]> { return this.dependencies.repository.listRotations(tenantId); }
  async getRotation(tenantId: string, rotationId: string): Promise<CertificateRotationEntity> {
    const value = await this.dependencies.repository.getRotation(tenantId, rotationId);
    if (!value) throw new AppError('RESOURCE_NOT_FOUND', '证书轮换任务不存在', { rotationId });
    return value;
  }

  async getInstallAction(tenantId: string, rotationId: string): Promise<Record<string, unknown>> {
    const rotation = await this.getRotation(tenantId, rotationId);
    if (!rotation.targetCertificateRequestId) throw new AppError('RESOURCE_VERSION_CONFLICT', '轮换尚未生成证书申请');
    const request = (await this.dependencies.internalCa.listRequests(tenantId)).find((item) => item.id === rotation.targetCertificateRequestId);
    if (!request || !request.certificateVersionId) throw new AppError('RESOURCE_VERSION_CONFLICT', '轮换证书尚未签发，不能生成安装动作');
    const targetKey = rotation.targetKeyReferenceId ? await this.dependencies.repository.getKeyReference(tenantId, rotation.targetKeyReferenceId) : undefined;
    return {
      operation: 'certificate.install_issued',
      rotationId: rotation.id,
      targetId: rotation.applicationAssetId,
      localKeyRef: targetKey?.opaqueReference,
      publicKeyFingerprintSha256: targetKey?.publicKeyFingerprintSha256 ?? request.publicKeyFingerprintSha256,
      certificateVersionId: request.certificateVersionId,
      certificateRequestId: request.id,
      certificateArtifactRef: `certificate-version://${request.certificateVersionId}`,
      privateKeyTransported: false,
    };
  }

  async markTlsVerified(input: { tenantId: string; rotationId: string; certificateVersionId: string; tlsEvidence: Record<string, unknown>; actorId: string; context?: RequestContext }): Promise<CertificateRotationEntity> {
    const rotation = await this.getRotation(input.tenantId, input.rotationId);
    if (!['install_pending', 'deploying', 'cutover_verified', 'revoke_pending'].includes(rotation.status)) throw new AppError('RESOURCE_VERSION_CONFLICT', '轮换当前不允许提交 TLS 验证', { status: rotation.status });
    const target = await this.requireVersion(input.tenantId, input.certificateVersionId);
    const source = await this.requireVersion(input.tenantId, rotation.sourceCertificateVersionId);
    if (target.id === source.id || target.publicKeyFingerprintSha256?.toLowerCase() === source.publicKeyFingerprintSha256?.toLowerCase()) throw new AppError('PUBLIC_KEY_MISMATCH', 'TLS 验证目标没有证明新公钥');
    let next = await this.dependencies.repository.saveRotation({
      ...rotation, targetCertificateVersionId: target.id, status: 'cutover_verified',
      evidence: { ...rotation.evidence, tls: structuredClone(input.tlsEvidence), targetPublicKeyFingerprintSha256: target.publicKeyFingerprintSha256 }, updatedAt: new Date().toISOString(),
    });
    try {
      const revocation = await this.dependencies.internalCa.requestRevocation(input.tenantId, source.id, 'superseded', input.actorId, input.context);
      const completed = revocation.status === 'revoked';
      next = await this.dependencies.repository.saveRotation({ ...next, status: completed ? 'completed' : 'revoke_pending', evidence: { ...next.evidence, revocationId: revocation.id, revocationStatus: revocation.status }, updatedAt: new Date().toISOString() });
    } catch (error) {
      next = await this.dependencies.repository.saveRotation({ ...next, status: 'revoke_pending', warnings: [...next.warnings, error instanceof Error ? error.message : String(error)], updatedAt: new Date().toISOString() });
    }
    return next;
  }

  private async requireVersion(tenantId: string, id: string): Promise<CertificateVersionEntity> {
    const version = await this.dependencies.certificates.getRepository().getVersion(id, tenantId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: id });
    return version;
  }
}
