import type { RequestContext } from '../../../common/tracing/request-context.js';
import type { DeploymentPlanDto, DryRunDeploymentPlanInput, ExecuteDeploymentPlanInput, SubmitDeploymentPlanInput } from '../../deployment-plans/dto/deployment-plans.dto.js';
import type { DeploymentPlansApplicationService } from '../../deployment-plans/application/deployment-plans.application-service.js';
import type { AutomationRunTargetDto, CreateDeploymentPlanActionConfigDto } from '../dto/automations.dto.js';

export interface AutomationDeploymentPort {
  create(input: {
    name: string;
    certificateVersionId?: string;
    certificateFormatId?: string;
    planType?: 'INSTALL' | 'UPDATE' | 'VERIFY_ONLY';
    selectionMode?: 'EXPLICIT' | 'LATEST_AUTO';
    targets: Array<{ certificateBindingId?: string; serviceAssetId?: string; strategyPayload?: Record<string, unknown> }>;
    policy: { approvalRequired?: boolean; riskLevel?: 'low' | 'medium' | 'high' | 'critical'; failurePolicy?: 'stop' | 'continue' | 'rollback'; batchSize?: number };
    idempotencyKey: string;
    actorId: string;
    tenantId: string;
  }, context?: RequestContext): Promise<DeploymentPlanDto>;
  dryRun(input: DryRunDeploymentPlanInput, context?: RequestContext): Promise<unknown>;
  submit(input: SubmitDeploymentPlanInput, context?: RequestContext): Promise<DeploymentPlanDto>;
  execute(input: ExecuteDeploymentPlanInput, context?: RequestContext): Promise<unknown>;
}

export class DeploymentPlansAutomationAdapter implements AutomationDeploymentPort {
  constructor(private readonly deploymentPlans: DeploymentPlansApplicationService) {}

  create(input: Parameters<AutomationDeploymentPort['create']>[0], context?: RequestContext): Promise<DeploymentPlanDto> {
    return this.deploymentPlans.create(input, context);
  }

  dryRun(input: DryRunDeploymentPlanInput, context?: RequestContext): Promise<unknown> { return this.deploymentPlans.dryRun(input, context); }
  submit(input: SubmitDeploymentPlanInput, context?: RequestContext): Promise<DeploymentPlanDto> { return this.deploymentPlans.submit(input, context); }
  execute(input: ExecuteDeploymentPlanInput, context?: RequestContext): Promise<unknown> { return this.deploymentPlans.execute(input, context); }
}

export class AutomationDeploymentActionService {
  constructor(private readonly deployment: AutomationDeploymentPort) {}

  async createPlan(input: {
    runId: string;
    target: AutomationRunTargetDto;
    config: CreateDeploymentPlanActionConfigDto;
    actorId: string;
    tenantId: string;
    requireApproval: boolean;
    failurePolicy: 'stop' | 'continue' | 'rollback';
  }): Promise<DeploymentPlanDto> {
    return this.deployment.create({
      name: `Automation ${input.runId} ${input.target.sequenceNo}`,
      certificateVersionId: input.config.certificateVersionId ?? input.target.targetSnapshot.certificateVersionId,
      planType: input.config.planType ?? 'UPDATE',
      selectionMode: input.config.selectionMode ?? 'EXPLICIT',
      targets: [{ certificateBindingId: input.target.targetSnapshot.bindingId, serviceAssetId: input.target.targetSnapshot.assetId }],
      policy: { approvalRequired: input.requireApproval, failurePolicy: input.failurePolicy, riskLevel: input.requireApproval ? 'high' : 'medium' },
      idempotencyKey: `automation:${input.runId}:target:${input.target.id}:create-plan`,
      actorId: input.actorId,
      tenantId: input.tenantId,
    });
  }

  dryRun(input: { planId: string; runId: string; actorId: string; tenantId: string; idempotencyKey: string }, context?: RequestContext): Promise<unknown> {
    return this.deployment.dryRun({ planId: input.planId, actorId: input.actorId, tenantId: input.tenantId, idempotencyKey: `automation:${input.runId}:dry-run:${input.planId}` }, context);
  }

  submit(input: { planId: string; actorId: string; tenantId: string; approvalId?: string }, context?: RequestContext): Promise<DeploymentPlanDto> {
    return this.deployment.submit(input, context);
  }

  execute(input: { planId: string; runId: string; actorId: string; tenantId: string; approvalId?: string }, context?: RequestContext): Promise<unknown> {
    return this.deployment.execute({ planId: input.planId, actorId: input.actorId, tenantId: input.tenantId, approvalId: input.approvalId, idempotencyKey: `automation:${input.runId}:execute:${input.planId}` }, context);
  }
}
