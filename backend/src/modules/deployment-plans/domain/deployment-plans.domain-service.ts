import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import type { DeploymentPlanStatus, ExecutionTargetKind } from '../../../shared/enums/core.enums.js';
import { assertTransition, InvalidStateTransitionError } from '../../../shared/state-machine/core-state-machine.js';
import type { CreateDeploymentPlanInput, DeploymentPlanPolicyDto } from '../dto/deployment-plans.dto.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity } from '../schema/deployment-plans.schema.js';

export class DeploymentPlansDomainService {
  normalizePolicy(policy: DeploymentPlanPolicyDto | undefined): Required<Pick<DeploymentPlanPolicyDto, 'approvalRequired' | 'riskLevel' | 'failurePolicy'>> & DeploymentPlanPolicyDto {
    return {
      approvalRequired: policy?.approvalRequired ?? false,
      riskLevel: policy?.riskLevel ?? 'medium',
      failurePolicy: policy?.failurePolicy ?? 'stop',
      batchSize: policy?.batchSize,
      retry: policy?.retry,
    };
  }

  assertCreateInput(input: CreateDeploymentPlanInput): void {
    if (!input.targets.length) throw new AppError('VALIDATION_FAILED', '部署计划至少需要一个目标');
    for (const [index, target] of input.targets.entries()) {
      if (!target.certificateBindingId) {
        throw new AppError('VALIDATION_FAILED', '部署目标必须引用 certificateBindingId，禁止绕过 CertificateBinding 直接部署到 Host', { index });
      }
      if (target.matchResult?.status === 'blocked') {
        throw new AppError('VALIDATION_FAILED', '能力匹配被阻断的目标不能进入部署计划', { index, matchResult: target.matchResult });
      }
    }
  }

  buildRequestHash(input: CreateDeploymentPlanInput): string {
    return this.hash({
      name: input.name,
      certificateVersionId: input.certificateVersionId,
      planType: input.planType ?? 'UPDATE',
      createdReason: input.createdReason ?? 'MANUAL',
      policy: this.normalizePolicy(input.policy),
      targets: input.targets.map((target) => ({
        certificateBindingId: target.certificateBindingId,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType ?? 'AGENT',
        requiredCapabilities: [...new Set(target.requiredCapabilities ?? [])].sort(),
        gatewayRoute: target.gatewayRoute ?? {
          gatewayId: target.gatewayId,
          zoneId: target.zoneId,
          adapter: target.adapter,
          delegatedTargetId: target.delegatedTargetId,
          fallbackSuggestions: target.fallbackSuggestions,
        },
      })).sort((a, b) => a.certificateBindingId.localeCompare(b.certificateBindingId)),
    });
  }

  buildSnapshotHash(plan: Omit<DeploymentPlanEntity, 'snapshotHash' | 'requestHash' | 'createdAt' | 'updatedAt' | 'version'>, targets: Array<Pick<DeploymentPlanTargetEntity, 'certificateBindingId' | 'executionTargetId' | 'executorType' | 'requiredCapabilities' | 'gatewayRoute'>>): string {
    return this.hash({
      tenantId: plan.tenantId,
      name: plan.name,
      planType: plan.planType,
      certificateVersionId: plan.certificateVersionId,
      policy: plan.policy,
      targets: targets.map((target) => ({
        certificateBindingId: target.certificateBindingId,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: [...target.requiredCapabilities].sort(),
        gatewayRoute: target.gatewayRoute,
      })).sort((a, b) => a.certificateBindingId.localeCompare(b.certificateBindingId)),
    });
  }

  transitionPlan(current: DeploymentPlanStatus, next: DeploymentPlanStatus): void {
    try {
      assertTransition('deploymentPlan', current, next);
    } catch (error) {
      if (error instanceof InvalidStateTransitionError) {
        throw new AppError('DEPLOYMENT_INVALID_STATE', error.message, { from: current, to: next });
      }
      throw error;
    }
  }

  isHighRisk(policy: DeploymentPlanPolicyDto): boolean {
    return policy.riskLevel === 'high' || policy.riskLevel === 'critical';
  }

  defaultExecutorType(value?: ExecutionTargetKind): ExecutionTargetKind {
    return value ?? 'AGENT';
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(canonicalize(value)).digest('hex');
  }
}
