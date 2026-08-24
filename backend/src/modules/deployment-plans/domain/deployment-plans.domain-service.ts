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
    if (!input.targets.length) {
      throw new AppError('VALIDATION_FAILED', '部署计划至少需要一个目标');
    }
    if ((input.selectionMode ?? 'EXPLICIT') === 'EXPLICIT' && !input.certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', 'EXPLICIT 模式必须指定 certificateVersionId', { field: 'certificateVersionId' });
    }
    if (input.certificateFormatId !== undefined && !String(input.certificateFormatId).trim()) {
      throw new AppError('VALIDATION_FAILED', 'certificateFormatId 不能为空', { field: 'certificateFormatId' });
    }
    for (const [index, target] of input.targets.entries()) {
      assertLegacyExecutionRetired(target.executorType, { index });
      const isWorkflowTarget = target.executorType === 'WORKFLOW';
      const workflowPayload = target.strategyPayload?.workflowRequest;
      const executionSource = target.strategyPayload?.executionSource as Record<string, unknown> | undefined;
      if (executionSource) {
        if (executionSource.type !== 'PLUGIN' && executionSource.type !== 'WORKFLOW') throw new AppError('VALIDATION_FAILED', '执行来源快照类型无效', { index });
        if (executionSource.type === 'PLUGIN' && executionSource.workflowExecutionBindingId) throw new AppError('EXECUTION_SOURCE_CONFLICT', '插件计划不能包含工作流执行绑定快照', { index });
        if (executionSource.type === 'WORKFLOW' && (executionSource.pluginBindingId || executionSource.assignmentId)) throw new AppError('EXECUTION_SOURCE_CONFLICT', '工作流计划不能包含插件执行快照', { index });
      }
      if (isWorkflowTarget && !workflowPayload) {
        throw new AppError('VALIDATION_FAILED', 'WORKFLOW 部署目标必须提供 workflowRequest', { index });
      }
      if (!isWorkflowTarget && !target.certificateBindingId && !target.managedTargetId && !target.siteAssetId) {
        throw new AppError('VALIDATION_FAILED', '部署目标必须提供 certificateBindingId、managedTargetId 或 siteAssetId 之一', { index });
      }
      if (target.matchResult?.status === 'blocked') {
        throw new AppError('VALIDATION_FAILED', '能力匹配为 blocked 的目标不能进入部署计划', { index, matchResult: target.matchResult });
      }
    }
  }

  buildRequestHash(input: CreateDeploymentPlanInput): string {
    return this.hash({
      name: input.name,
      certificateVersionId: input.certificateVersionId,
      certificateFormatId: input.certificateFormatId,
      selectionMode: input.selectionMode ?? 'EXPLICIT',
      planType: input.planType ?? 'UPDATE',
      createdReason: input.createdReason ?? 'MANUAL',
      policy: this.normalizePolicy(input.policy),
      targets: input.targets.map((target) => ({
        certificateBindingId: target.certificateBindingId,
        managedTargetId: target.managedTargetId,
        siteAssetId: target.siteAssetId,
        domain: target.domain,
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
      })).sort((a, b) => this.targetSortKey(a).localeCompare(this.targetSortKey(b))),
    });
  }

  buildSnapshotHash(plan: Omit<DeploymentPlanEntity, 'snapshotHash' | 'requestHash' | 'createdAt' | 'updatedAt' | 'version'>, targets: Array<Pick<DeploymentPlanTargetEntity, 'certificateBindingId' | 'executionTargetId' | 'executorType' | 'requiredCapabilities' | 'gatewayRoute'>>): string {
    return this.hash({
      tenantId: plan.tenantId,
      name: plan.name,
      planType: plan.planType,
      selectionMode: plan.selectionMode,
      certificateVersionId: plan.certificateVersionId,
      certificateFormatId: plan.certificateFormatId,
      policy: plan.policy,
      targets: targets.map((target) => ({
        certificateBindingId: target.certificateBindingId,
        executionTargetId: target.executionTargetId,
        executorType: target.executorType,
        requiredCapabilities: [...target.requiredCapabilities].sort(),
        gatewayRoute: target.gatewayRoute,
      })).sort((a, b) => (a.certificateBindingId ?? '').localeCompare(b.certificateBindingId ?? '')),
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

  private targetSortKey(target: Pick<CreateDeploymentPlanInput['targets'][number], 'certificateBindingId' | 'managedTargetId' | 'siteAssetId' | 'domain'>): string {
    return [target.certificateBindingId ?? '', target.managedTargetId ?? '', target.siteAssetId ?? '', target.domain ?? ''].join(':');
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(canonicalize(value)).digest('hex');
  }
}

export function assertLegacyExecutionRetired(executorType: unknown, details: Record<string, unknown> = {}): void {
  if (typeof executorType === 'string' && executorType.trim().toUpperCase() === 'SCRIPT_PACKAGE') {
    throw new AppError('LEGACY_EXECUTION_RETIRED', 'Legacy SCRIPT_PACKAGE 执行类型已下线，请重新生成标准插件计划', details);
  }
}
