import type { RequestContext } from '../../../common/tracing/request-context.js';
import type { CreateDeploymentPlanFromApplicationAssetInput, DeploymentPlanDto, DryRunDeploymentPlanInput, ExecuteDeploymentPlanInput, SubmitDeploymentPlanInput } from '../../deployment-plans/dto/deployment-plans.dto.js';
import type { DeploymentPlansApplicationService } from '../../deployment-plans/application/deployment-plans.application-service.js';
import type { ExecutionSourceDto } from '../../executions/dto/executions.dto.js';
import type { AutomationRunTargetDto, CreateDeploymentPlanActionConfigDto } from '../dto/automations.dto.js';

export interface AutomationDeploymentPort {
  get?(planId: string, tenantId: string): Promise<DeploymentPlanDto>;
  createFromApplicationAsset(input: CreateDeploymentPlanFromApplicationAssetInput, context?: RequestContext): Promise<DeploymentPlanDto>;
  dryRun(input: DryRunDeploymentPlanInput, context?: RequestContext): Promise<unknown>;
  submit(input: SubmitDeploymentPlanInput, context?: RequestContext): Promise<DeploymentPlanDto>;
  execute(input: ExecuteDeploymentPlanInput, context?: RequestContext): Promise<unknown>;
  cleanupTemporaryPlan?(input: { planId: string; tenantId: string }): Promise<boolean>;
}

export class DeploymentPlansAutomationAdapter implements AutomationDeploymentPort {
  constructor(private readonly deploymentPlans: DeploymentPlansApplicationService) {}

  get(planId: string, tenantId: string): Promise<DeploymentPlanDto> { return this.deploymentPlans.get(planId, tenantId); }
  createFromApplicationAsset(input: CreateDeploymentPlanFromApplicationAssetInput, context?: RequestContext): Promise<DeploymentPlanDto> {
    return this.deploymentPlans.createFromApplicationAsset(input, context);
  }

  dryRun(input: DryRunDeploymentPlanInput, context?: RequestContext): Promise<unknown> { return this.deploymentPlans.dryRun(input, context); }
  submit(input: SubmitDeploymentPlanInput, context?: RequestContext): Promise<DeploymentPlanDto> { return this.deploymentPlans.submit(input, context); }
  execute(input: ExecuteDeploymentPlanInput, context?: RequestContext): Promise<unknown> { return this.deploymentPlans.execute(input, context); }
  cleanupTemporaryPlan(input: { planId: string; tenantId: string }): Promise<boolean> {
    return this.deploymentPlans.cleanupTemporaryPlan(input);
  }
}

export class AutomationDeploymentActionService {
  constructor(private readonly deployment: AutomationDeploymentPort) {}

  getPlan(planId: string, tenantId: string): Promise<DeploymentPlanDto> {
    if (!this.deployment.get) throw new Error('AUTOMATION_DEPLOYMENT_STATUS_UNAVAILABLE');
    return this.deployment.get(planId, tenantId);
  }

  async createPlan(input: {
    runId: string;
    target: AutomationRunTargetDto;
    config: CreateDeploymentPlanActionConfigDto;
    actorId: string;
    tenantId: string;
    requireApproval: boolean;
    failurePolicy: 'stop' | 'continue' | 'rollback';
  }): Promise<DeploymentPlanDto> {
    const applicationAssetId = input.target.targetSnapshot.assetId;
    if (!applicationAssetId) {
      throw new Error('AUTOMATION_APPLICATION_ASSET_MISSING');
    }
    return this.deployment.createFromApplicationAsset({
      applicationAssetId,
      targetCertificateVersionId: input.config.certificateVersionId ?? input.target.targetSnapshot.certificateVersionId,
      planType: input.config.planType ?? 'UPDATE',
      selectionMode: input.config.selectionMode ?? 'EXPLICIT',
      policy: { approvalRequired: input.requireApproval, failurePolicy: input.failurePolicy, riskLevel: input.requireApproval ? 'high' : 'medium' },
      reuseDraft: false,
      temporary: true,
      idempotencyKey: `automation:${input.runId}:target:${input.target.id}:create-plan`,
      actorId: input.actorId,
      tenantId: input.tenantId,
    });
  }

  dryRun(input: { planId: string; runId: string; automationId?: string; approvalId?: string; actorId: string; tenantId: string; idempotencyKey: string }, context?: RequestContext): Promise<unknown> {
    return this.deployment.dryRun({ planId: input.planId, actorId: input.actorId, tenantId: input.tenantId, idempotencyKey: `automation:${input.runId}:dry-run:${input.planId}`, executionSource: { type: 'automation', automationRunId: input.runId, automationId: input.automationId, approvalId: input.approvalId } }, context);
  }

  submit(input: { planId: string; actorId: string; tenantId: string; approvalId?: string; executionSource?: ExecutionSourceDto }, context?: RequestContext): Promise<DeploymentPlanDto> {
    return this.deployment.submit(input, context);
  }

  execute(input: { planId: string; runId: string; automationId?: string; actorId: string; tenantId: string; approvalId?: string }, context?: RequestContext): Promise<unknown> {
    return this.deployment.execute({ planId: input.planId, actorId: input.actorId, tenantId: input.tenantId, approvalId: input.approvalId, idempotencyKey: `automation:${input.runId}:execute:${input.planId}`, executionSource: { type: 'automation', automationRunId: input.runId, automationId: input.automationId, approvalId: input.approvalId } }, context);
  }

  cleanupTemporaryPlan(input: { planId: string; tenantId: string }): Promise<boolean> {
    return this.deployment.cleanupTemporaryPlan?.(input) ?? Promise.resolve(false);
  }
}
