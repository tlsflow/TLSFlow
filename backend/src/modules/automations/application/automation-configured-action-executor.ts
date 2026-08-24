import type { AutomationActionDto, AutomationRunDto, AutomationRunTargetDto } from '../dto/automations.dto.js';
import type { AutomationActionExecutionPort } from './automation-run-coordinator.js';
import { AutomationDeploymentActionService } from './automation-deployment-actions.js';
import { AutomationNotificationActionService } from './automation-notification-actions.js';

export class AutomationConfiguredActionExecutor implements AutomationActionExecutionPort {
  constructor(
    private readonly deployment: AutomationDeploymentActionService,
    private readonly notifications: AutomationNotificationActionService,
  ) {}

  async execute(input: { run: AutomationRunDto; target: AutomationRunTargetDto; action: AutomationActionDto; requireApproval: boolean }) {
    if (input.action.type === 'create_deployment_plan') {
      const plan = await this.deployment.createPlan({
        runId: input.run.id, target: input.target, config: input.action.config, actorId: input.run.createdBy,
        tenantId: input.run.tenantId, requireApproval: input.requireApproval, failurePolicy: 'stop',
      });
      return { status: 'succeeded' as const, referenceType: 'deployment_plan' as const, referenceId: plan.id };
    }
    if (input.action.type === 'execute_deployment_plan') {
      const planId = input.target.deploymentPlanId;
      if (!planId) throw new Error('AUTOMATION_DEPLOYMENT_PLAN_MISSING');
      if (input.action.config.dryRunFirst) await this.deployment.dryRun({ planId, runId: input.run.id, actorId: input.run.createdBy, tenantId: input.run.tenantId, idempotencyKey: '' });
      const plan = await this.deployment.submit({ planId, actorId: input.run.createdBy, tenantId: input.run.tenantId });
      if (plan.status === 'PENDING_APPROVAL') return { status: 'waiting_approval' as const, referenceType: 'deployment_plan' as const, referenceId: plan.id };
      const execution = await this.deployment.execute({ planId, runId: input.run.id, actorId: input.run.createdBy, tenantId: input.run.tenantId }) as { run?: { id?: string } };
      return { status: 'running' as const, referenceType: 'execution_run' as const, referenceId: execution.run?.id };
    }
    const notification = await this.notifications.enqueue({ tenantId: input.run.tenantId, run: input.run, target: input.target, config: input.action.config, eventKey: input.action.config.eventKey });
    return { status: 'succeeded' as const, referenceType: 'notification_request' as const, referenceId: notification.requestId };
  }
}
