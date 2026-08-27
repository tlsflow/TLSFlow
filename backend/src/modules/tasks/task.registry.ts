import { AppError } from '../../common/errors/app-error.js';
import type { TaskDefinition, TaskCategory } from './task.types.js';

const defaultDefinitions: TaskDefinition[] = [
  ['CERTIFICATE_DRY_RUN', 'EXECUTION', 'tasks.types.certificateDryRun', 'certificate.dry-run', 'certificate.read'],
  ['CERTIFICATE_DEPLOY', 'EXECUTION', 'tasks.types.certificateDeploy', 'certificate.deploy', 'deployment.plan.execute'],
  ['DEPLOYMENT_APPROVAL', 'EXECUTION', 'tasks.types.deploymentApproval', 'deployment.approval', 'approval.decide'],
  ['CERTIFICATE_VERIFY', 'EXECUTION', 'tasks.types.certificateVerify', 'certificate.verify', 'execution.run.read'],
  ['CERTIFICATE_ROLLBACK', 'EXECUTION', 'tasks.types.certificateRollback', 'certificate.rollback', 'execution.rollback'],
  ['AGENT_INSTALL', 'EXECUTION', 'tasks.types.agentInstall', 'agent.install', 'agent.write'],
  ['AGENT_UPDATE', 'EXECUTION', 'tasks.types.agentUpdate', 'agent.update', 'agent.write'],
  // 外置 CA Node 已退役，但保留任务类型以便历史队列可以被识别并失败关闭，
  // 避免旧任务因类型不存在而卡在不可解释的状态。
  ['CA_NODE_TASK', 'SYSTEM', 'tasks.types.caNodeTask', 'ca.node-task', 'ca.operations.read'],
  ['ACME_CERTIFICATE_ISSUE', 'SYSTEM', 'tasks.types.acmeCertificateIssue', 'acme.issue', 'ca.request.retry'],
  ['ACME_CERTIFICATE_RENEWAL', 'SYSTEM', 'tasks.types.acmeCertificateRenewal', 'acme.renewal', 'ca.request.retry'],
  ['PLUGIN_REFERENCE_REFRESH', 'EXECUTION', 'tasks.types.pluginReferenceRefresh', 'plugin.reference-refresh', 'plugin.manage'],
  ['DEPLOYMENT_PLAN_REFRESH', 'EXECUTION', 'tasks.types.deploymentPlanRefresh', 'deployment.plan.refresh', 'deployment.plan.write'],
  ['MONITORING_BATCH', 'MONITORING', 'tasks.types.monitoringBatch', 'monitoring.batch', 'monitor.dashboard.read'],
  ['MONITORING_PROBE', 'MONITORING', 'tasks.types.monitoringProbe', 'monitoring.probe', 'monitor.target.read'],
  ['CREDENTIAL_HEALTH_CHECK', 'MONITORING', 'tasks.types.credentialHealthCheck', 'credential.health-check', 'credential.health-check'],
  ['CERTIFICATE_REVOCATION', 'SYSTEM', 'tasks.types.certificateRevocation', 'certificate.revocation', 'certificate.lifecycle'],
  ['CRL_PUBLISH', 'SYSTEM', 'tasks.types.crlPublish', 'ca.crl-publish', 'certificate.lifecycle'],
  ['TRUST_DISTRIBUTION', 'SYSTEM', 'tasks.types.trustDistribution', 'certificate.trust-distribution', 'certificate.lifecycle'],
  ['GATEWAY_DELEGATION', 'SYSTEM', 'tasks.types.gatewayDelegation', 'gateway.delegate', 'gateway.read'],
  ['WORKFLOW_RUN', 'SYSTEM', 'tasks.types.workflowRun', 'workflow.run', 'workflow.read'],
  ['AUTOMATION_TRIGGER_DELIVERY', 'SYSTEM', 'tasks.types.automationTriggerDelivery', 'automation.trigger-delivery', 'automation.read'],
  // 自动化运行属于执行类任务；等待审批只是执行前的活动状态，不应被后台任务过滤掉。
  ['AUTOMATION_RUN', 'EXECUTION', 'tasks.types.automationRun', 'automation.run', 'automation.read'],
  ['REPORT_EXPORT', 'SYSTEM', 'tasks.types.reportExport', 'report.export', 'report.read'],
  ['NOTIFICATION_DELIVERY', 'SYSTEM', 'tasks.types.notificationDelivery', 'notification.delivery', 'notification.channel.read'],
].map(([taskType, category, displayKey, executorKey, permissionKey]) => ({
  id: `task-definition-${String(taskType).toLowerCase()}`,
  taskType: String(taskType),
  version: 1,
  category: category as TaskCategory,
  displayKey: String(displayKey),
  executorKey: String(executorKey),
  timeoutSeconds: 1800,
  retryPolicy: { maxAttempts: 3, backoffSeconds: 30 },
  permissionKey: String(permissionKey),
  sensitivePaths: ['payload.secret', 'payload.password', 'payload.privateKey', 'payload.token'],
  enabled: true,
}));

export class TaskRegistry {
  private readonly definitions = new Map<string, TaskDefinition>();

  constructor(definitions: readonly TaskDefinition[] = defaultDefinitions) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: TaskDefinition): this {
    const key = `${definition.taskType}:${definition.version}`;
    if (this.definitions.has(key)) throw new AppError('RESOURCE_ALREADY_EXISTS', '任务类型定义重复', { taskType: definition.taskType, version: definition.version });
    if (
      !definition.taskType
      || !definition.executorKey
      || !definition.permissionKey
      || definition.version < 1
      || definition.timeoutSeconds < 1
      || definition.retryPolicy.maxAttempts < 1
      || definition.retryPolicy.backoffSeconds < 0
    ) {
      throw new AppError('VALIDATION_FAILED', '任务类型定义无效', { taskType: definition.taskType });
    }
    this.definitions.set(key, structuredClone(definition));
    return this;
  }

  get(taskType: string, version?: number): TaskDefinition {
    const candidates = [...this.definitions.values()]
      .filter((item) => item.taskType === taskType)
      .sort((left, right) => right.version - left.version);
    const definition = candidates.find((item) => version === undefined || item.version === version);
    if (!definition) throw new AppError('TASK_TYPE_NOT_REGISTERED', '任务类型未注册', { taskType, version });
    if (!definition.enabled) throw new AppError('TASK_TYPE_DISABLED', '任务类型已停用', { taskType, version: definition.version });
    return structuredClone(definition);
  }

  list(): TaskDefinition[] {
    return [...this.definitions.values()].map((item) => structuredClone(item));
  }
}

export { defaultDefinitions };
