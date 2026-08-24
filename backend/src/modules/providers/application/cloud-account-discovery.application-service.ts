import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { DeploymentAssetContextV1 } from '../../deployment-inputs/dto/deployment-asset-context.dto.js';
import { buildPluginActionBindings } from '../../executions/application/plugin-action-binding.service.js';
import { expandPluginActionGrantActions, PluginRunnerExecutorAdapter, type PluginActionBindingV1 } from '../../executions/application/plugin-runner-executor.adapter.js';
import type { ExecutionGrantService } from '../../executions/execution-grant.service.js';
import type { WorkflowExecutorDispatchResult, WorkflowRunResult, WorkflowStep } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { PluginWorkflowBindingsRepositoryPort } from '../../plugins/repository/plugin-workflow-bindings.repository.js';
import type { CloudAccountAsset } from '../dto/providers.dto.js';
import { CloudAccountAssetsApplicationService } from './cloud-account-assets.application-service.js';
import { CloudResourceProjectionService, type CloudResourceProjectionBatch, type PersistedCloudResourceProjectionBatch } from '../discovery/cloud-resource-projection.js';

export type CloudAccountDiscoveryOperation = 'connection-test' | 'discover';

export interface CloudAccountDiscoveryResult {
  operation: CloudAccountDiscoveryOperation;
  status: 'SUCCEEDED';
  assetId: string;
  providerKey: string;
  pluginVersionId: string;
  workflowVersionId: string;
  signatureVerified: boolean;
  resources: Record<string, unknown>[];
  projection?: {
    devices: number;
    frameworks: number;
    sites: number;
  };
  completedAt: string;
}

export interface CloudAccountDiscoveryDependencies {
  db: DatabasePort;
  cloudAccounts: Pick<CloudAccountAssetsApplicationService, 'get'>;
  plugins: Pick<UnifiedPluginsApplicationService, 'listCatalog' | 'getVersionForTenant'>;
  workflows: Pick<WorkflowTemplatesApplicationService, 'getVersion' | 'runWithDispatcher'>;
  workflowBindings: PluginWorkflowBindingsRepositoryPort;
  projection: CloudResourceProjectionService;
  pluginActionExecutor: Pick<PluginRunnerExecutorAdapter, 'executeAction'>;
  executionGrants: Pick<ExecutionGrantService, 'create' | 'revoke'>;
}

/**
 * 中文说明：云账号动作的唯一应用入口。这里只允许连接测试和资源发现，
 * 每次执行都从 Provider 目录解析当前最新的已启用插件版本。
 */
export class CloudAccountDiscoveryApplicationService {
  constructor(private readonly dependencies: CloudAccountDiscoveryDependencies) {}

  async execute(tenantId: string, assetId: string, operation: CloudAccountDiscoveryOperation): Promise<CloudAccountDiscoveryResult> {
    const asset = await this.dependencies.cloudAccounts.get(tenantId, assetId);
    assertActiveAsset(asset);
    if (asset.providerKey !== 'cloud.aliyun') {
      throw new AppError('CAPABILITY_MISSING', '当前第一阶段只实现阿里云云服务发现', { providerKey: asset.providerKey });
    }
    const current = await this.resolveCurrentExecution(tenantId, asset, operation);
    const workflow = await this.dependencies.workflows.getVersion(current.workflowVersionId);
    if (workflow.status !== 'published' || workflow.templateId !== current.workflowTemplateId) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '当前云服务插件的 WorkflowVersion 不可执行', { workflowVersionId: current.workflowVersionId });
    }
    const plugin = await this.dependencies.plugins.getVersionForTenant(tenantId, current.pluginVersionId);
    if (plugin.status !== 'ENABLED' || plugin.pluginId !== asset.providerKey || plugin.version !== workflow.content.metadata.version) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '当前 PluginVersion 与 WorkflowVersion 不一致', {
        pluginVersionId: plugin.id,
        workflowVersionId: workflow.id,
      });
    }
    const credentials = await this.resolveCredentialSecretRefs(tenantId, asset.credentialRef);
    const idempotencyKey = `cloud:${asset.id}:${operation}:${Date.now()}:${randomToken()}`;
    const planDigest = createHash('sha256').update(`${tenantId}:${asset.id}:${current.pluginVersionId}:${current.workflowVersionId}:${operation}`, 'utf8').digest('hex');
    const bindings = buildPluginActionBindings({
      tenantId,
      workflowVersionId: workflow.id,
      content: workflow.content,
      plugin,
      planDigest,
    });
    const outputByStep = new Map<string, Record<string, unknown>>();
    const stepName = readSinglePluginActionStep(workflow.content.steps, operation).name;
    const resolvedInput = buildResolvedInput(asset, credentials, buildAliyunRequest(asset, operation), idempotencyKey);
    const run = await this.dependencies.workflows.runWithDispatcher({
      templateVersionId: workflow.id,
      resolvedInput,
      mode: 'real_test',
      tenantId,
      systemValues: { execution: { idempotencyKey } },
      stepOutputs: {},
    }, async (dispatch) => this.dispatchPluginAction({
      dispatch,
      tenantId,
      asset,
      workflow,
      bindings,
      outputByStep,
      idempotencyKey,
      planDigest,
    }));
    assertWorkflowSucceeded(run, operation);
    const output = outputByStep.get(stepName) ?? {};
    const resources = readResourceList(output.resources);
    let projection: CloudResourceProjectionBatch | undefined;
    if (operation === 'discover') {
      projection = await this.dependencies.projection.persistBatch({
        tenantId,
        cloudAccountAssetId: asset.id,
        pluginId: plugin.pluginId,
        pluginVersionId: plugin.id,
        provider: asset.providerKey,
        providerDisplayName: '阿里云 CDN',
        topology: 'ACCOUNT_FRAMEWORK',
        discoveryProviderKey: `plugin:${asset.providerKey}:discover`,
        discoveredAt: new Date().toISOString(),
      }, resources);
    }
    return {
      operation,
      status: 'SUCCEEDED',
      assetId: asset.id,
      providerKey: asset.providerKey,
      pluginVersionId: plugin.id,
      workflowVersionId: workflow.id,
      signatureVerified: output.signatureVerified === true,
      resources,
      ...(projection ? { projection: { devices: projection.devices.length, frameworks: projection.frameworks.length, sites: projection.sites.length } } : {}),
      completedAt: new Date().toISOString(),
    };
  }

  async listResources(tenantId: string, assetId: string): Promise<PersistedCloudResourceProjectionBatch> {
    await this.dependencies.cloudAccounts.get(tenantId, assetId);
    return this.dependencies.projection.listForAsset(tenantId, assetId);
  }

  private async resolveCurrentExecution(tenantId: string, asset: CloudAccountAsset, operation: CloudAccountDiscoveryOperation): Promise<{ pluginVersionId: string; workflowTemplateId: string; workflowVersionId: string }> {
    const capabilityKey = operationCapability(operation);
    const catalog = await this.dependencies.plugins.listCatalog(tenantId, 'zh-CN');
    const current = catalog.find((item) => item.pluginId === asset.providerKey && item.status === 'ENABLED');
    if (!current) {
      throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '没有找到当前 Provider 的已启用插件版本', {
        providerKey: asset.providerKey,
        operation,
      });
    }
    if (!current.capabilities.some((capability) => capability.key === capabilityKey)) {
      throw new AppError('CAPABILITY_MISSING', '当前插件版本没有声明云账号动作能力', {
        providerKey: asset.providerKey,
        pluginVersionId: current.pluginVersionId,
        capabilityKey,
      });
    }
    const binding = await this.dependencies.workflowBindings.find(current.pluginVersionId, capabilityKey, capabilityKey);
    if (!binding || binding.pluginVersionId !== current.pluginVersionId) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '当前插件版本没有对应 WorkflowVersion', {
        pluginVersionId: current.pluginVersionId,
        operation,
      });
    }
    return {
      pluginVersionId: current.pluginVersionId,
      workflowTemplateId: binding.workflowTemplateId,
      workflowVersionId: binding.workflowVersionId,
    };
  }

  private async resolveCredentialSecretRefs(tenantId: string, credentialRef: string): Promise<{ accessKeyId: string; accessKeySecret: string }> {
    const credentialId = /^credential:\/\/([^#]+)(?:#.*)?$/.exec(credentialRef.trim())?.[1]?.trim();
    if (!credentialId) throw new AppError('VALIDATION_FAILED', '阿里云云账号 CredentialRef 格式无效');
    const result = await this.dependencies.db.query<{ secret_slots: Record<string, unknown>; status: string; kind: string }>(
      'select secret_slots, status, kind from credential_profiles where tenant_id=$1 and id=$2',
      [tenantId, credentialId],
    );
    const profile = result.rows[0];
    if (!profile || profile.status !== 'active' || profile.kind !== 'CLOUD_PROVIDER') {
      throw new AppError('VALIDATION_FAILED', '阿里云云账号凭据不存在、未启用或类型不匹配', { credentialId });
    }
    const slots = profile.secret_slots ?? {};
    const accessKeyId = requiredSecretRef(slots.accessKeyId, 'accessKeyId');
    const accessKeySecret = requiredSecretRef(slots.accessKeySecret, 'accessKeySecret');
    return { accessKeyId, accessKeySecret };
  }

  private async dispatchPluginAction(input: {
    dispatch: { runId: string; step: WorkflowStep; renderedPlan: unknown; attempt: number; rollback: boolean };
    tenantId: string;
    asset: CloudAccountAsset;
    workflow: { id: string };
    bindings: Record<string, PluginActionBindingV1>;
    outputByStep: Map<string, Record<string, unknown>>;
    idempotencyKey: string;
    planDigest: string;
  }): Promise<WorkflowExecutorDispatchResult> {
    const plan = asRecord(input.dispatch.renderedPlan);
    const step = input.dispatch.step;
    const binding = input.bindings[step.name];
    if (!binding) return { success: false, errorCode: 'PLUGIN_ACTION_BINDING_MISSING', errorMessage: '云账号 Workflow 缺少冻结 PluginActionBinding' };
    const actionInput = asRecord(plan.input);
    const grant = await this.dependencies.executionGrants.create({
      tenantId: input.tenantId,
      runId: input.dispatch.runId,
      stepId: `cloud-${input.asset.id}-${step.name}`,
      workflowVersionId: binding.workflowVersionId,
      pluginVersionId: binding.pluginVersionId,
      pluginId: binding.pluginId,
      capability: binding.capability,
      actionId: binding.actionId,
      actionContractVersion: binding.actionContractVersion,
      inputSchemaSha256: binding.inputSchemaSha256,
      outputSchemaSha256: binding.outputSchemaSha256,
      planDigest: input.planDigest,
      executorType: 'plugin.action',
      allowedSecretRefs: collectSecretRefs(actionInput),
      allowedActions: ['plugin.action.execute', binding.actionId, ...expandPluginActionGrantActions(binding.hostPermissions)],
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    try {
      const result = await this.dependencies.pluginActionExecutor.executeAction({
        binding,
        executionId: input.dispatch.runId,
        executionStepId: `cloud-${input.asset.id}-${step.name}`,
        input: actionInput,
        grantRefs: [grant.id],
        idempotencyKey: input.idempotencyKey,
        deadlineAt: new Date(Date.now() + 120_000).toISOString(),
        compatibilityContext: {
          productFamily: 'cloud.aliyun.cdn',
          managementMethod: 'PLUGIN',
        },
      });
      if (result.success) {
        input.outputByStep.set(step.name, result.output);
        return { success: true, body: result.output, logs: [`cloud.action:${binding.actionId}:success`] };
      }
      return { success: false, errorCode: result.errorCode, errorMessage: result.errorMessage, body: result.detail };
    } finally {
      await this.dependencies.executionGrants.revoke(grant.id);
    }
  }
}

function operationCapability(operation: CloudAccountDiscoveryOperation): string {
  return operation === 'connection-test' ? 'cloud.service.connection-test' : 'cloud.service.discover';
}

function assertActiveAsset(asset: CloudAccountAsset): void {
  if (asset.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', '云账号资产不是 ACTIVE 状态，拒绝执行云服务动作', { assetId: asset.id, status: asset.status });
}

function buildAliyunRequest(_asset: CloudAccountAsset, operation: CloudAccountDiscoveryOperation): Record<string, unknown> {
  const request = {
    method: 'POST',
    uri: '/',
    action: 'DescribeUserDomains',
    apiVersion: '2018-05-10',
    body: {},
  };
  if (operation === 'connection-test') return request;
  return {
    ...request,
    requests: [
      {
        method: 'POST',
        uri: '/',
        endpoint: 'https://cdn.aliyuncs.com',
        action: 'DescribeUserDomains',
        apiVersion: '2018-05-10',
        query: { PageNumber: 1, PageSize: 100 },
        body: {},
      },
    ],
  };
}

function buildResolvedInput(asset: CloudAccountAsset, credentials: { accessKeyId: string; accessKeySecret: string }, request: Record<string, unknown>, idempotencyKey: string): ResolvedDeploymentInputV1 {
  const assetContext: DeploymentAssetContextV1 = {
    apiVersion: 'gcac.deployment-asset-context/v1',
    application: { id: asset.id, address: `cloud://${asset.id}`, serverName: asset.displayName, port: 443, protocol: 'https' },
    deployment: { targets: [], certificateResourceName: '' },
  };
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext,
    variables: {
      cloudServiceRef: asset.id,
      accessKeyIdSecretRef: credentials.accessKeyId,
      accessKeySecretSecretRef: credentials.accessKeySecret,
      request,
      idempotencyKey,
    },
    connections: {},
    credentials: {},
    artifacts: {},
    provenance: {},
    sensitivePaths: ['variables.accessKeyIdSecretRef', 'variables.accessKeySecretSecretRef'],
    issues: [],
    executable: true,
    resolvedSha256: '0'.repeat(64),
  };
}

function readSinglePluginActionStep(steps: WorkflowStep[], operation: CloudAccountDiscoveryOperation): Extract<WorkflowStep, { type: 'plugin.action' }> {
  const capability = operationCapability(operation);
  const step = steps.find((item): item is Extract<WorkflowStep, { type: 'plugin.action' }> => item.type === 'plugin.action' && item.capability === capability);
  if (!step) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '云账号 Workflow 缺少固定 Plugin Action 步骤', { operation });
  return step;
}

function assertWorkflowSucceeded(run: WorkflowRunResult, operation: CloudAccountDiscoveryOperation): void {
  if (run.status !== 'success') {
    const failed = [...run.stepResults, ...run.rollbackResults].find((step) => step.status === 'failed');
    throw new AppError(failed?.errorCode ?? 'PLUGIN_ACTION_FAILED', failed?.errorMessage ?? `云账号 ${operation} 执行失败`, { operation, workflowRunId: run.id });
  }
}

function readResourceList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function collectSecretRefs(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('secret://') ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectSecretRefs);
}

function requiredSecretRef(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw new AppError('VALIDATION_FAILED', `阿里云凭据缺少 ${name} SecretRef`);
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}
