import { AppError } from '../../../common/errors/app-error.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import type { ExecutionsRepository } from '../../executions/repository/executions.repository.js';

export interface CertificatePromotionInput {
  tenantId: string;
  certificateVersionId: string;
  deploymentPlanId: string;
  executionRunId: string;
  tlsVerify: {
    success: boolean;
    certificateFingerprintSha256: string;
    verifiedAt?: string;
  };
  actorId: string;
}

export class CertificatePromotionService {
  constructor(
    private readonly certificates: CertificatesApplicationService,
    private readonly deploymentPlans: DeploymentPlansRepository,
    private readonly executions: ExecutionsRepository,
  ) {}

  async promote(input: CertificatePromotionInput) {
    if (!input.tlsVerify.success) {
      throw new AppError('CERTIFICATE_PROMOTION_BLOCKED', 'TLS Verify 未成功，证书版本不能 Promotion');
    }
    const version = await this.certificates.getRepository().getVersion(input.certificateVersionId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '待 Promotion 的证书版本不存在');
    const activationState = version.activationState ?? 'promoted';
    if (activationState === 'promoted') return version;
    if (!['staged', 'deploying', 'verified'].includes(activationState)) {
      throw new AppError('CERTIFICATE_PROMOTION_BLOCKED', '证书版本不在可 Promotion 状态', { activationState });
    }
    if (version.fingerprintSha256.toLowerCase() !== input.tlsVerify.certificateFingerprintSha256.toLowerCase()) {
      throw new AppError('CERTIFICATE_PROMOTION_BLOCKED', 'TLS Verify 指纹与待 Promotion 证书不一致');
    }

    const plan = await this.deploymentPlans.getPlan(input.deploymentPlanId, input.tenantId);
    if (!plan || plan.certificateVersionId !== input.certificateVersionId) {
      throw new AppError('CERTIFICATE_PROMOTION_BLOCKED', '部署计划不存在或未绑定待 Promotion 证书');
    }
    if (plan.status !== 'SUCCESS') {
      throw new AppError('CERTIFICATE_PROMOTION_BLOCKED', '部署计划尚未成功完成', { status: plan.status });
    }
    const run = await this.executions.getRun(input.executionRunId, input.tenantId);
    if (!run || run.deploymentPlanId !== plan.id || run.status !== 'SUCCESS') {
      throw new AppError('CERTIFICATE_PROMOTION_BLOCKED', '执行 Run 尚未成功完成');
    }
    return this.certificates.promoteVersion({
      certificateVersionId: input.certificateVersionId,
      actorId: input.actorId,
    });
  }
}
