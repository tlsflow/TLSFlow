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
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
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
    managedTargets: number;
  };
  completedAt: string;
}

export interface CloudAccountDiscoveryDependencies {
  db: DatabasePort;
  cloudAccounts: Pick<CloudAccountAssetsApplicationService, 'get'>;
  /** 标准插件资源通过 pg_service_assets 执行动作；旧 cloudAccounts 仅供兼容 API。 */
  serviceAssets?: Pick<AssetsApplicationService, 'getServiceAsset'>;
  plugins: Pick<UnifiedPluginsApplicationService, 'listCatalog' | 'getVersionForTenant'>;
  workflows: Pick<WorkflowTemplatesApplicationService, 'getVersion' | 'runWithDispatcher'>;
  workflowBindings: PluginWorkflowBindingsRepositoryPort;
  projection: CloudResourceProjectionService;
  pluginActionExecutor: Pick<PluginRunnerExecutorAdapter, 'executeAction'>;
  executionGrants: Pick<ExecutionGrantService, 'create' | 'revoke'>;
}

interface DiscoveryAsset {
  id: string;
  tenantId: string;
  providerKey: string;
  displayName: string;
  credentialRef: string;
  metadata: Record<string, unknown>;
  scope?: { metadata?: Record<string, unknown> };
  status: string;
}

/**
 * 中文说明：云账号动作的唯一应用入口。这里只允许连接测试和资源发现，
 * 每次执行都从 CloudAccountAsset 的 CapabilityAssignment 读取冻结插件版本。
 */
export class CloudAccountDiscoveryApplicationService {
  constructor(private readonly dependencies: CloudAccountDiscoveryDependencies) {}

  async execute(tenantId: string, assetId: string, operation: CloudAccountDiscoveryOperation): Promise<CloudAccountDiscoveryResult> {
    const asset = await this.dependencies.cloudAccounts.get(tenantId, assetId);
    return this.executeForAsset(tenantId, toDiscoveryAsset(asset), operation, 'CLOUD_ACCOUNT_ASSET');
  }

  /** 标准插件资源执行入口，所有云 Provider 共用，不读取 CloudAccountAsset 表。 */
  async executeServiceAsset(tenantId: string, serviceAssetId: string, operation: CloudAccountDiscoveryOperation): Promise<CloudAccountDiscoveryResult> {
    const asset = await this.dependencies.serviceAssets?.getServiceAsset(tenantId, serviceAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '标准 ServiceAsset 不存在', { serviceAssetId });
    return this.executeForAsset(tenantId, toDiscoveryAsset(asset), operation, 'APPLICATION_ASSET');
  }

  private async executeForAsset(
    tenantId: string,
    asset: DiscoveryAsset,
    operation: CloudAccountDiscoveryOperation,
    ownerType: 'CLOUD_ACCOUNT_ASSET' | 'APPLICATION_ASSET',
  ): Promise<CloudAccountDiscoveryResult> {
    assertActiveAsset(asset);
    const current = await this.resolveCurrentExecution(tenantId, asset, operation, ownerType);
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
    const resolvedInput = buildResolvedInput(asset, credentials, buildCloudRequest(asset, plugin), idempotencyKey);
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
      pluginManifest: plugin.manifest,
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
        ...(ownerType === 'APPLICATION_ASSET' ? { serviceAssetId: asset.id } : { cloudAccountAssetId: asset.id }),
        pluginId: plugin.pluginId,
        pluginVersionId: plugin.id,
        provider: asset.providerKey,
        providerDisplayName: asset.displayName,
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
      ...(projection ? {
        projection: {
          devices: projection.devices.length,
          frameworks: projection.frameworks.length,
          sites: projection.sites.length,
          managedTargets: projection.managedTargets.length,
        },
      } : {}),
      completedAt: new Date().toISOString(),
    };
  }

  async listResources(tenantId: string, assetId: string): Promise<PersistedCloudResourceProjectionBatch> {
    await this.dependencies.cloudAccounts.get(tenantId, assetId);
    return this.dependencies.projection.listForAsset(tenantId, assetId, 'CLOUD_ACCOUNT_ASSET');
  }

  async listServiceAssetResources(tenantId: string, serviceAssetId: string): Promise<PersistedCloudResourceProjectionBatch> {
    const asset = await this.dependencies.serviceAssets?.getServiceAsset(tenantId, serviceAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '标准 ServiceAsset 不存在', { serviceAssetId });
    return this.dependencies.projection.listForAsset(tenantId, serviceAssetId, 'SERVICE_ASSET');
  }

  private async resolveCurrentExecution(tenantId: string, asset: DiscoveryAsset, operation: CloudAccountDiscoveryOperation, ownerType: 'CLOUD_ACCOUNT_ASSET' | 'APPLICATION_ASSET'): Promise<{ pluginVersionId: string; workflowTemplateId: string; workflowVersionId: string }> {
    const capabilityKey = operationCapability(operation);
    const assignment = (await this.dependencies.db.query<{ plugin_version_id: string }>(
      `select plugin_version_id from plugin_capability_assignments
       where tenant_id=$1 and owner_type=$2 and owner_id=$3 and capability_key=$4 and status='ACTIVE'`,
      [tenantId, ownerType, asset.id, capabilityKey],
    )).rows[0];
    if (!assignment) throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '云账号没有冻结的插件能力指派', { assetId: asset.id, operation });
    const plugin = await this.dependencies.plugins.getVersionForTenant(tenantId, assignment.plugin_version_id);
    if (plugin.pluginId !== asset.providerKey || plugin.status !== 'ENABLED' || !plugin.manifest.capabilities.some((capability) => capability.key === capabilityKey)) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '云账号冻结的插件版本不可执行', { pluginVersionId: assignment.plugin_version_id, capabilityKey });
    }
    const binding = await this.dependencies.workflowBindings.find(assignment.plugin_version_id, capabilityKey, capabilityKey);
    if (!binding || binding.pluginVersionId !== assignment.plugin_version_id) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '当前插件版本没有对应 WorkflowVersion', {
        pluginVersionId: assignment.plugin_version_id,
        operation,
      });
    }
    return {
      pluginVersionId: assignment.plugin_version_id,
      workflowTemplateId: binding.workflowTemplateId,
      workflowVersionId: binding.workflowVersionId,
    };
  }

  private async resolveCredentialSecretRefs(tenantId: string, credentialRef: string): Promise<Record<string, string>> {
    const credentialId = /^credential:\/\/([^#]+)(?:#.*)?$/.exec(credentialRef.trim())?.[1]?.trim();
    if (!credentialId) throw new AppError('VALIDATION_FAILED', '云账号 CredentialRef 格式无效');
    const result = await this.dependencies.db.query<{ secret_slots: Record<string, unknown>; status: string; kind: string }>(
      'select secret_slots, status, kind from credential_profiles where tenant_id=$1 and id=$2',
      [tenantId, credentialId],
    );
    const profile = result.rows[0];
    if (!profile || profile.status !== 'active' || profile.kind !== 'CLOUD_PROVIDER') {
      throw new AppError('VALIDATION_FAILED', '云账号凭据不存在、未启用或类型不匹配', { credentialId });
    }
    const slots = profile.secret_slots ?? {};
    const resolved = Object.fromEntries(Object.entries(slots).map(([name, value]) => [name, requiredSecretRef(value, name)]));
    if (Object.keys(resolved).length === 0) throw new AppError('VALIDATION_FAILED', '云账号凭据没有可用 SecretRef', { credentialId });
    return resolved;
  }

  private async dispatchPluginAction(input: {
    dispatch: { runId: string; step: WorkflowStep; renderedPlan: unknown; attempt: number; rollback: boolean };
    tenantId: string;
    asset: DiscoveryAsset;
    pluginManifest: { compatibility?: { productFamilies?: string[] } };
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
          productFamily: resolveProductFamily(input.asset, input.pluginManifest),
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

function assertActiveAsset(asset: DiscoveryAsset): void {
  if (asset.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', '云账号资产不是 ACTIVE 状态，拒绝执行云服务动作', { assetId: asset.id, status: asset.status });
}

function buildCloudRequest(asset: DiscoveryAsset, plugin: { manifest: { resources: Record<string, unknown> }; resources: Record<string, string> }): Record<string, unknown> {
  const configured = asset.scope?.metadata?.request ?? asset.metadata.request;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) return structuredClone(configured as Record<string, unknown>);
  const onboardingPath = readStringPath(plugin.manifest.resources, ['onboarding', 'cloudAccount']);
  if (onboardingPath) {
    try {
      const onboarding = JSON.parse(plugin.resources[onboardingPath] ?? '') as { defaults?: { request?: unknown } };
      if (onboarding.defaults?.request && typeof onboarding.defaults.request === 'object' && !Array.isArray(onboarding.defaults.request)) {
        return structuredClone(onboarding.defaults.request as Record<string, unknown>);
      }
    } catch {
      // 插件资源校验已在版本装载阶段执行；此处仅在缺少默认请求时回退到最小合同。
    }
  }
  return {
    method: 'POST',
    uri: '/',
    body: {},
  };
}

function readStringPath(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current : undefined;
}

function resolveProductFamily(
  asset: DiscoveryAsset,
  manifest: { compatibility?: { productFamilies?: string[] } },
): string | undefined {
  const configured = asset.scope?.metadata?.productFamily ?? asset.metadata.productFamily;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const declared = manifest.compatibility?.productFamilies?.find((value) => typeof value === 'string' && value.trim());
  return declared?.trim() || asset.providerKey;
}

function buildResolvedInput(asset: DiscoveryAsset, credentials: Record<string, string>, request: Record<string, unknown>, idempotencyKey: string): ResolvedDeploymentInputV1 {
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
      ...Object.fromEntries(Object.entries(credentials).map(([name, value]) => [`${name}SecretRef`, value])),
      ...(Object.values(credentials)[0] ? { credentialSecretRef: Object.values(credentials)[0] } : {}),
      request,
      idempotencyKey,
    },
    connections: {},
    credentials: {},
    artifacts: {},
    provenance: {},
    sensitivePaths: Object.keys(credentials).map((name) => `variables.${name}SecretRef`),
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
  if (typeof value !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw new AppError('VALIDATION_FAILED', `云账号凭据缺少 ${name} SecretRef`);
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

function toDiscoveryAsset(asset: CloudAccountAsset | ServiceAssetDto): DiscoveryAsset {
  if ('assetKind' in asset) {
    return {
      id: asset.id,
      tenantId: asset.tenantId,
      providerKey: asset.providerKey,
      displayName: asset.displayName,
      credentialRef: asset.credentialRef,
      metadata: asset.metadata,
      scope: asset.scope,
      status: asset.status,
    };
  }
  const credentialRef = typeof asset.metadata.credentialRef === 'string' ? asset.metadata.credentialRef : '';
  const pluginId = typeof asset.metadata.pluginId === 'string' ? asset.metadata.pluginId : '';
  if (!pluginId || !credentialRef) {
    throw new AppError('VALIDATION_FAILED', '标准 ServiceAsset 缺少插件或凭据引用', { serviceAssetId: asset.id });
  }
  return {
    id: asset.id,
    tenantId: asset.tenantId,
    providerKey: pluginId,
    displayName: asset.displayName ?? pluginId,
    credentialRef,
    metadata: asset.metadata,
    status: asset.status,
  };
}
