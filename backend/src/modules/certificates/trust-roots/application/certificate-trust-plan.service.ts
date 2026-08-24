import { X509Certificate } from 'node:crypto';
import { AppError } from '../../../../common/errors/app-error.js';
import type { AgentsApplicationService } from '../../../agents/application/agents.application-service.js';
import type { TrustRootsApplicationService } from './trust-roots.application-service.js';
import type { RootCertificateRecordDto } from '../dto/trust-roots.dto.js';

export interface CertificateTrustPlanSnapshot {
  apiVersion: 'gcac.certificate-trust-plan/v1';
  decision: 'skip' | 'install';
  reasonCode: 'root_already_trusted' | 'root_missing_install_required';
  actionType: 'certificate.trust.install';
  actionSchemaVersion: '1.0';
  store: 'root';
  agentId: string;
  rootCertificateId: string;
  fingerprintSha256: string;
  certificatePem: string;
  plannedAt: string;
  inspection: {
    actionType: 'certificate.trust.inspect';
    actionSchemaVersion: '1.0';
    status: 'found' | 'not_found';
    inspectedAt: string;
    detail: Record<string, unknown>;
  };
}

export interface BuildCertificateTrustPlanInput {
  tenantId: string;
  actorId: string;
  agentId: string;
  certificateVersionId: string;
  requestId: string;
}

export interface BuildCertificateTrustPlanResult {
  plan: CertificateTrustPlanSnapshot;
  root: RootCertificateRecordDto;
}

export interface CertificateTrustPlanDependencies {
  agents: Pick<AgentsApplicationService, 'enqueueDirectTask' | 'executeTaskDirect'>;
  trustRoots: Pick<TrustRootsApplicationService, 'discoverRoot' | 'resolveVersionInstallableRoot'>;
}

export class CertificateTrustPlanService {
  constructor(private readonly dependencies: CertificateTrustPlanDependencies) {}

  async build(input: BuildCertificateTrustPlanInput): Promise<BuildCertificateTrustPlanResult> {
    const resolvedRoot = await this.dependencies.trustRoots.resolveVersionInstallableRoot(
      input.certificateVersionId,
      input.tenantId,
      input.actorId,
    );
    if (!resolvedRoot) {
      const discovered = await this.dependencies.trustRoots.discoverRoot({
        tenantId: input.tenantId,
        certificateVersionId: input.certificateVersionId,
        createdBy: input.actorId,
      });
      if (discovered.status !== 'found') {
        throw new AppError('VALIDATION_FAILED', '证书版本缺少可安装的已验证根证书，不能生成宿主根信任计划', {
          code: 'CERTIFICATE_TRUST_ROOT_UNRESOLVED',
          certificateVersionId: input.certificateVersionId,
          fingerprintSha256: discovered.fingerprintSha256,
          failureCode: discovered.failureCode,
        });
      }
    }

    const material = await this.dependencies.trustRoots.resolveVersionInstallableRoot(
      input.certificateVersionId,
      input.tenantId,
      input.actorId,
    );
    if (!material) {
      throw new AppError('VALIDATION_FAILED', '证书版本根证书解析后仍不可用，拒绝生成宿主根信任计划', {
        code: 'CERTIFICATE_TRUST_ROOT_UNRESOLVED',
        certificateVersionId: input.certificateVersionId,
      });
    }

    const inspectTask = await this.dependencies.agents.enqueueDirectTask(input.tenantId, {
      agentId: input.agentId,
      executionRunId: `trustplan:${input.certificateVersionId}`,
      executionStepId: `trustinspect:${input.agentId}:${material.root.fingerprintSha256}`,
      idempotencyKey: `certificate.trust.inspect:${input.agentId}:${material.root.fingerprintSha256}`,
      payload: {
        actionType: 'certificate.trust.inspect',
        actionSchemaVersion: '1.0',
        store: 'root',
        fingerprintSha256: material.root.fingerprintSha256,
      },
    }, input.requestId);
    const inspection = await this.dependencies.agents.executeTaskDirect(
      input.tenantId,
      inspectTask.id,
      `${input.requestId}:execute`,
    );
    const inspectionDetail = inspection.detail ?? {};
    const status = readInspectStatus(inspectionDetail.status);
    if (!status) {
      throw new AppError('VALIDATION_FAILED', '宿主根信任检查结果无效，拒绝继续部署', {
        code: 'CERTIFICATE_TRUST_INSPECT_INVALID',
        certificateVersionId: input.certificateVersionId,
        agentId: input.agentId,
        detail: inspectionDetail,
      });
    }
    const fingerprintSha256 = normalizeFingerprint(
      readOptionalString(inspectionDetail.fingerprintSha256) ?? material.root.fingerprintSha256,
    );
    if (fingerprintSha256 !== material.root.fingerprintSha256) {
      throw new AppError('VALIDATION_FAILED', '宿主根信任检查返回的证书指纹与目标根不一致，拒绝继续部署', {
        code: 'CERTIFICATE_TRUST_INSPECT_MISMATCH',
        certificateVersionId: input.certificateVersionId,
        agentId: input.agentId,
        expectedFingerprintSha256: material.root.fingerprintSha256,
        actualFingerprintSha256: fingerprintSha256,
      });
    }

    const plannedAt = new Date().toISOString();
    return {
      root: material.root,
      plan: {
        apiVersion: 'gcac.certificate-trust-plan/v1',
        decision: status === 'found' ? 'skip' : 'install',
        reasonCode: status === 'found' ? 'root_already_trusted' : 'root_missing_install_required',
        actionType: 'certificate.trust.install',
        actionSchemaVersion: '1.0',
        store: 'root',
        agentId: input.agentId,
        rootCertificateId: material.root.id,
        fingerprintSha256: material.root.fingerprintSha256,
        certificatePem: material.certificatePem,
        plannedAt,
        inspection: {
          actionType: 'certificate.trust.inspect',
          actionSchemaVersion: '1.0',
          status,
          inspectedAt: plannedAt,
          detail: structuredClone(inspectionDetail),
        },
      },
    };
  }
}

function readInspectStatus(value: unknown): 'found' | 'not_found' | undefined {
  if (value === 'found' || value === 'not_found') return value;
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeFingerprint(value: string | undefined): string | undefined {
  return value?.replaceAll(':', '').trim().toLowerCase() || undefined;
}

export function derToPem(der: Buffer): string {
  const certificate = new X509Certificate(der);
  return certificate.toString();
}
