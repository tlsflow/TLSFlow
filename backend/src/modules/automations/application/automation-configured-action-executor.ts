import type { AutomationActionExecutionPort } from './automation-run-coordinator.js';
import { AutomationActionRegistry } from './automation-action-registry.js';
import { AutomationDeploymentActionService } from './automation-deployment-actions.js';
import { AutomationNotificationActionService } from './automation-notification-actions.js';
import { AutomationExecutorRegistry } from './automation-executor-registry.js';

export class AutomationConfiguredActionExecutor implements AutomationActionExecutionPort {
  private readonly actionRegistry: AutomationActionRegistry;
  private readonly executorRegistry: AutomationExecutorRegistry;

  constructor(
    private readonly deployment: AutomationDeploymentActionService,
    private readonly notifications: AutomationNotificationActionService,
    actionRegistry = new AutomationActionRegistry(),
    executorRegistry?: AutomationExecutorRegistry,
  ) {
    this.actionRegistry = actionRegistry;
    this.executorRegistry = executorRegistry ?? new AutomationExecutorRegistry()
      .register('deployment.plan.create', async (input) => {
        if (input.action.type !== 'create_deployment_plan') throw new Error('AUTOMATION_ACTION_UNSUPPORTED');
        const plan = await this.deployment.createPlan({
          runId: input.run.id,
          target: input.target,
          config: input.action.config,
          actorId: input.run.createdBy,
          tenantId: input.run.tenantId,
          requireApproval: input.requireApproval,
          failurePolicy: input.run.executionOptions?.stopOnError === false ? 'continue' : 'stop',
        });
        return { status: 'succeeded' as const, referenceType: 'deployment_plan' as const, referenceId: plan.id };
      })
      .register('deployment.plan.execute', async (input) => {
        if (input.action.type !== 'execute_deployment_plan') throw new Error('AUTOMATION_ACTION_UNSUPPORTED');
        const planId = input.target.deploymentPlanId;
        if (!planId) throw new Error('AUTOMATION_DEPLOYMENT_PLAN_MISSING');
        let plan = await this.deployment.getPlan(planId, input.run.tenantId);
        if (plan.status === 'DRAFT') {
          // 旧配置中的 dryRunFirst / executionOptions.dryRun 仅作历史兼容。
          // 自动化不能再创建带副作用的预检任务，正式执行会自行同步校验。
          plan = await this.deployment.submit({
            planId,
            actorId: input.run.createdBy,
            tenantId: input.run.tenantId,
            executionSource: {
              type: 'automation',
              automationRunId: input.run.id,
              automationId: input.run.automationId,
              approvalId: input.approvalId,
            },
          });
        }
        if (plan.status === 'PENDING_APPROVAL') return { status: 'waiting_approval' as const, referenceType: 'deployment_plan' as const, referenceId: plan.id };
        if (plan.status === 'READY') {
          const execution = await this.deployment.execute({ planId, runId: input.run.id, automationId: input.run.automationId, approvalId: input.approvalId, actorId: input.run.createdBy, tenantId: input.run.tenantId }) as { run?: { id?: string } };
          return { status: 'running' as const, referenceType: 'execution_run' as const, referenceId: execution.run?.id };
        }
        if (plan.status === 'RUNNING') return { status: 'running' as const, referenceType: 'execution_run' as const, referenceId: input.target.executionRunId };
        if (plan.status === 'SUCCESS' || plan.status === 'PARTIAL_SUCCESS') return { status: 'succeeded' as const, referenceType: 'execution_run' as const, referenceId: input.target.executionRunId };
        const errorCode = plan.status === 'ROLLED_BACK' ? 'AUTOMATION_ROLLBACK_FAILED' : `AUTOMATION_DEPLOYMENT_${plan.status}`;
        throw Object.assign(new Error(errorCode), { errorCode });
      })
      .register('notification.send', async (input) => {
        if (input.action.type !== 'send_notification') throw new Error('AUTOMATION_ACTION_UNSUPPORTED');
        const notification = await this.notifications.enqueue({
          tenantId: input.run.tenantId,
          run: input.run,
          target: input.target,
          config: input.action.config,
          eventKey: input.action.config.eventKey,
        });
        return { status: 'succeeded' as const, referenceType: 'notification_request' as const, referenceId: notification.requestId };
      });
  }

  async execute(input: Parameters<AutomationActionExecutionPort['execute']>[0]) {
    const contract = this.actionRegistry.get(input.action.type);
    const result = await this.executorRegistry.get(contract.executorKey)(input);
    if (result.referenceType && !contract.referenceTypes.includes(result.referenceType)) {
      throw new Error('AUTOMATION_ACTION_REFERENCE_TYPE_INVALID');
    }
    return result;
  }
}
