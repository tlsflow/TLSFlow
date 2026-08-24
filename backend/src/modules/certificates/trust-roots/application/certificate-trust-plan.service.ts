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
  agents: Pick<AgentsApplicationService, 'enqueueTask'>;
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

    const inspectTask = await this.dependencies.agents.enqueueTask(input.tenantId, {
      agentId: input.agentId,
      executionRunId: `trustplan:${input.certificateVersionId}`,
      executionStepId: `trustinspect:${input.agentId}:${material.root.fingerprintSha256}`,
      idempotencyKey: `certificate.trust.inspect:${input.agentId}:${material.root.fingerprintSha256}:${input.requestId}`,
      payload: {
        actionType: 'agent.fact.collect',
        actionSchemaVersion: '1.0',
        factKinds: ['certificate_store'],
        factRequest: {
          store: 'root',
          fingerprintSha256: material.root.fingerprintSha256,
        },
      },
    }, input.requestId);
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '宿主根信任检查已提交 Agent v2 事实采集任务，必须等待 Receipt 后再生成计划', {
      code: 'CERTIFICATE_TRUST_INSPECT_PENDING',
      certificateVersionId: input.certificateVersionId,
      agentId: input.agentId,
      taskId: inspectTask.id,
      actionType: 'agent.fact.collect',
      asyncPending: true,
    });
  }
}

export function derToPem(der: Buffer): string {
  const certificate = new X509Certificate(der);
  return certificate.toString();
}
