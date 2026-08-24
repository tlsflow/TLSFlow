import { AppError } from '../../../common/errors/app-error.js';
import type { TaskExecutionResult, TaskRun } from '../../tasks/task.types.js';
import type { PluginWorkflowCapabilityExecutor } from '../../executions/application/plugin-runner-executor.adapter.js';
import type { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { CloudAccountAssetsApplicationService } from './cloud-account-assets.application-service.js';
import { canonicalResourceHash } from '../../../shared/plugin-resource-hash.js';
import type { CloudResourceProjectionService } from '../discovery/cloud-resource-projection.js';

export const cloudCapabilityActionTypes = {
  CONNECTION_TEST: 'CLOUD_CONNECTION_TEST',
  DISCOVER: 'CLOUD_DISCOVER',
  DEPLOY: 'CLOUD_DEPLOY',
  VERIFY: 'CLOUD_VERIFY',
  ROLLBACK: 'CLOUD_ROLLBACK',
} as const;

export type CloudCapabilityAction = 'connection-test' | 'discover' | 'deploy' | 'verify' | 'rollback';

const capabilityByAction: Record<CloudCapabilityAction, string> = {
  'connection-test': 'cloud.service.connection-test',
  discover: 'cloud.service.discover',
  deploy: 'certificate.deploy',
  verify: 'certificate.verify',
  rollback: 'certificate.rollback',
};

export class CloudCapabilityTaskService {
  constructor(
    private readonly cloudAccounts: Pick<CloudAccountAssetsApplicationService, 'get' | 'resolveCredentialSecretRef'>,
    private readonly bindings: Pick<PluginBindingsApplicationService, 'resolveAssignment' | 'getTenantBinding'>,
    private readonly plugins: Pick<UnifiedPluginsApplicationService, 'getVersionForTenant'>,
    private readonly workflows: Pick<PluginWorkflowPublisherService, 'require'>,
    private readonly executor?: PluginWorkflowCapabilityExecutor,
    private readonly projector?: Pick<CloudResourceProjectionService, 'persist'>,
  ) {}

  async execute(task: TaskRun): Promise<TaskExecutionResult> {
    const assetId = requiredString(task, 'cloudAccountAssetId');
    const action = requiredAction(task.payload.action ?? actionFromTaskType(task.taskType));
    const capabilityKey = capabilityByAction[action];
    const asset = await this.cloudAccounts.get(task.tenantId, assetId);
    if (asset.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', '云账号资产未处于 ACTIVE 状态', { assetId, status: asset.status });
    const assignment = await this.bindings.resolveAssignment(task.tenantId, capabilityKey, { cloudAccountAssetId: asset.id });
    if (!assignment || assignment.ownerType !== 'CLOUD_ACCOUNT_ASSET') {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', '云账号资产没有固定的 Capability Assignment', { assetId, capabilityKey });
    }
    const binding = await this.bindings.getTenantBinding(task.tenantId, assignment.pluginBindingId);
    if (binding.managedContext?.cloudAccountAssetId !== asset.id || binding.pluginVersionId !== assignment.pluginVersionId) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '云账号 Binding 与 Assignment provenance 不一致', { assetId, capabilityKey });
    }
    const version = await this.plugins.getVersionForTenant(task.tenantId, assignment.pluginVersionId);
    const capability = version.manifest.capabilities.find((item) => item.key === capabilityKey);
    if (!capability) throw new AppError('VALIDATION_FAILED', '固定 PluginVersion 未声明所需 Capability', { pluginVersionId: version.id, capabilityKey });
    const workflow = await this.workflows.require(version.id, capabilityKey);
    if (!this.executor) {
      return {
        success: false,
        errorCode: 'PLUGIN_RUNNER_START_FAILED',
        errorMessage: '生产 Plugin Runner 未完成装配，云 Capability 任务已失败关闭',
        detail: { assetId, capabilityKey, pluginVersionId: version.id, executionStatus: 'FAILED' },
      };
    }
    const input = await this.buildInput(task, asset.id, binding.inputBindings as unknown as Record<string, unknown>, action);
    const result = await this.executor.execute({
      tenantId: task.tenantId,
      targetId: asset.id,
      actorId: task.requestedBy,
      workflowVersionId: workflow.workflowVersionId,
      pluginVersionId: version.id,
      pluginId: version.pluginId,
      pluginVersion: version.version,
      packageHash: version.packageSha256,
      manifestHash: version.manifestSha256,
      resourceHash: canonicalResourceHash(version.resourceSha256),
      capability: capabilityKey,
      writeEffect: action === 'deploy' || action === 'rollback',
      hostPermissions: [...version.approvedPermissions],
      input,
    });
    const detail: Record<string, unknown> = {
      assetId,
      capabilityKey,
      pluginVersionId: version.id,
      workflowVersionId: workflow.workflowVersionId,
      ...(result.detail ?? {}),
    };
    if (action === 'discover' && result.success) {
      const normalizedObjects = readRecordArray(detail.normalizedObjects);
      if (normalizedObjects.length > 0 && !this.projector) {
        throw new AppError('SYSTEM_INTERNAL_ERROR', 'Cloud Resource Projector 未接入，发现结果不得伪造成功', { assetId, pluginVersionId: version.id });
      }
      const projectionSummary = { frameworks: 0, sites: 0, managedTargets: 0, skippedTargets: 0 };
      for (const resource of normalizedObjects) {
        const provider = typeof resource.provider === 'string' && resource.provider.trim()
          ? resource.provider
          : readSummaryProvider(detail.summary);
        if (!provider) throw new AppError('VALIDATION_FAILED', 'Cloud Resource 缺少稳定 Provider 来源', { assetId, pluginVersionId: version.id });
        const projection = await this.projector!.persist({
          tenantId: task.tenantId,
          cloudAccountAssetId: asset.id,
          pluginId: version.pluginId,
          pluginVersionId: version.id,
          provider,
          declaredCapabilities: version.manifest.capabilities.map((item) => item.key),
          // 中文说明：该键跨插件版本稳定，版本由资源 provenance 单独记录。
          discoveryProviderKey: `plugin:${version.pluginId}`,
        }, resource);
        projectionSummary.frameworks += 1;
        projectionSummary.sites += 1;
        if (projection.managedTarget) projectionSummary.managedTargets += 1;
        else projectionSummary.skippedTargets += 1;
      }
      detail.projectionSummary = projectionSummary;
    }
    return {
      success: result.success,
      ...(result.success ? {} : { errorCode: result.errorCode ?? 'CLOUD_CAPABILITY_FAILED', errorMessage: result.errorMessage ?? 'Cloud Capability 执行失败' }),
      detail,
    };
  }

  private async buildInput(task: TaskRun, assetId: string, inputBindings: Record<string, unknown>, action: CloudCapabilityAction): Promise<Record<string, unknown>> {
    const credentialBinding = firstCredentialBinding(inputBindings);
    const secretRef = credentialBinding
      ? await this.cloudAccounts.resolveCredentialSecretRef(task.tenantId, credentialBinding.credentialId, credentialBinding.slot)
      : undefined;
    if (!secretRef) throw new AppError('VALIDATION_FAILED', 'Cloud Binding 缺少凭据槽位', { assetId });
    const request = isRecord(task.payload.input) && isRecord((task.payload.input as Record<string, unknown>).request)
      ? (task.payload.input as Record<string, unknown>).request
      : { method: 'POST', uri: '/', action, timestamp: new Date().toISOString(), body: {} };
    const provided = isRecord(task.payload.input) ? task.payload.input : {};
    return {
      ...provided,
      cloudServiceRef: assetId,
      credential: { grantId: '__AUTO_GRANT__', secretRef },
      request,
      security: {
        tokenRef: `task://${task.id}`,
        decisionRef: `task://${task.id}/decision`,
        nonce: task.id,
        receiptRef: `task://${task.id}/receipt`,
        localPolicyRef: `task://${task.id}/policy`,
        grantRef: '__AUTO_GRANT__',
      },
      ...(action === 'deploy' || action === 'rollback'
        ? { certificateArtifactRef: requiredString(task, 'certificateArtifactRef') }
        : {}),
    };
  }
}

function actionFromTaskType(taskType: string): CloudCapabilityAction {
  const match = Object.entries(cloudCapabilityActionTypes).find(([, value]) => value === taskType)?.[0];
  if (!match) throw new AppError('VALIDATION_FAILED', '未知 Cloud Capability 任务类型', { taskType });
  return match === 'CONNECTION_TEST' ? 'connection-test' : match.toLowerCase() as CloudCapabilityAction;
}

function requiredAction(value: unknown): CloudCapabilityAction {
  if (typeof value !== 'string' || !Object.hasOwn(capabilityByAction, value)) {
    throw new AppError('VALIDATION_FAILED', 'Cloud Capability action 无效', { action: value });
  }
  return value as CloudCapabilityAction;
}

function requiredString(task: TaskRun, key: string): string {
  const value = task.payload[key];
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_FAILED', `Cloud 任务缺少 ${key}`, { taskId: task.id });
  return value.trim();
}

function firstCredentialBinding(inputBindings: Record<string, unknown>): { credentialId: string; slot?: string } | undefined {
  const credentials = inputBindings.credentials;
  if (!isRecord(credentials)) return undefined;
  for (const [slot, value] of Object.entries(credentials)) {
    if (!isRecord(value) || typeof value.credentialId !== 'string' || value.credentialId.trim() === '') continue;
    return { credentialId: value.credentialId.trim(), slot };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readSummaryProvider(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.provider !== 'string' || !value.provider.trim()) return undefined;
  return value.provider.trim();
}
