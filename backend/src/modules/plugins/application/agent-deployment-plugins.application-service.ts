import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import { assertPluginGcacCompatibility } from '../../../common/version.js';
import { newId } from '../../../shared/id.js';
import { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { PluginEnableInput, PluginPermissionApprovalInput } from '../dto/plugins.dto.js';
import type {
  AgentAtomicExecutionPlanV1,
  AgentDeploymentPluginManifestV1,
  AgentPluginBindingInput,
  AgentPluginMount,
  AgentPluginPackageRecord,
  AgentPluginPackageUploadInput,
  PluginCatalogActivationType,
  CreateAgentPluginMountInput,
  PluginCatalogItem,
} from '../dto/agent-deployment-plugins.dto.js';
import { PgPluginsRepository, type PluginsRepository } from '../repository/plugins.repository.js';
import { validateAgentDeploymentPluginManifest, validateAgentPluginVariableValues } from '../schema/agent-deployment-plugins.schema.js';
import { builtinAgentPluginManifests } from '../builtin-agent-plugins/builtin-agent-plugins.js';

const tenantFallback = '00000000-0000-0000-0000-000000000000';
const trustedMockSignaturePrefix = 'mock-trusted:';
const defaultUserAgentPluginRootDir = fileURLToPath(new URL('../../../../../data/agent-plugins/', import.meta.url));

export class AgentDeploymentPluginsApplicationService {
  constructor(
    private readonly repository: PluginsRepository = new PgPluginsRepository(),
    private readonly agents = new AgentsApplicationService(),
    private readonly workflowTemplates = new WorkflowTemplatesApplicationService(),
    private readonly userPluginRootDir = defaultUserAgentPluginRootDir,
  ) {}

  async uploadPackage(input: AgentPluginPackageUploadInput, tenantId = tenantFallback): Promise<AgentPluginPackageRecord> {
    const manifest = validateAgentDeploymentPluginManifest(input.manifest);
    assertPluginGcacCompatibility(manifest.pluginId, manifest.minGcacVersion);
    const packageHash = hash(input.packageContent);
    if (input.expectedHash && input.expectedHash !== packageHash) {
      throw new AppError('VALIDATION_FAILED', 'Agent 插件包 hash 不匹配', { expectedHash: input.expectedHash, packageHash });
    }
    const signatureStatus = verifyMockSignature(input.signature, packageHash);
    if (signatureStatus === 'invalid') throw new AppError('PLUGIN_SIGNATURE_INVALID', 'Agent 插件签名无效');
    const storageKey = await this.persistUserPackage(manifest, input, packageHash);
    const permissionApprovalStatus = manifest.permissions.some((permission) => permission.risk === 'high') ? 'pending' : 'not_required';
    const now = new Date().toISOString();
    return this.repository.saveAgentPackage({
      id: newId('agplg'),
      tenantId,
      manifest,
      packageHash,
      expectedHash: input.expectedHash,
      signature: input.signature,
      signatureStatus,
      installStatus: permissionApprovalStatus === 'pending' ? 'pending_approval' : 'installed_disabled',
      permissionApprovalStatus,
      approvedPermissions: manifest.permissions.filter((permission) => permission.risk !== 'high').map((permission) => permission.name),
      storageKey,
      uploadedAt: now,
      updatedAt: now,
    });
  }

  listPackages(tenantId = tenantFallback): Promise<AgentPluginPackageRecord[]> {
    return this.listPackagesWithBuiltins(tenantId);
  }

  private async listPackagesWithBuiltins(tenantId: string): Promise<AgentPluginPackageRecord[]> {
    await this.ensureBuiltinPackages(tenantId);
    const [records, activations] = await Promise.all([
      this.repository.listAgentPackages(tenantId),
      this.repository.listCatalogActivations(tenantId),
    ]);
    const enabled = new Set(activations
      .filter((record) => record.catalogType === 'AGENT_DEPLOYMENT' && record.status === 'enabled')
      .map((record) => record.pluginId));
    return records.map((record) => ({
      ...record,
      catalogEnabled: record.installStatus === 'enabled' && enabled.has(record.id),
    }));
  }

  async approvePermissions(input: PluginPermissionApprovalInput): Promise<AgentPluginPackageRecord> {
    const record = await this.requirePackage(input.pluginPackageId);
    const declared = new Set(record.manifest.permissions.map((permission) => permission.name));
    const unknown = input.approvedPermissions.filter((permission) => !declared.has(permission));
    if (unknown.length > 0) throw new AppError('PLUGIN_PERMISSION_DENIED', '审批权限超过 Agent 插件声明范围', { unknown });
    return this.repository.saveAgentPackage({
      ...record,
      approvedPermissions: [...new Set(input.approvedPermissions)],
      permissionApprovalStatus: 'approved',
      installStatus: 'installed_disabled',
      updatedAt: new Date().toISOString(),
    });
  }

  async enablePackage(input: PluginEnableInput): Promise<AgentPluginPackageRecord> {
    const record = await this.requirePackage(input.pluginPackageId);
    assertPluginGcacCompatibility(record.manifest.pluginId, record.manifest.minGcacVersion);
    const approved = new Set(record.approvedPermissions);
    const missing = record.manifest.permissions
      .filter((permission) => permission.risk === 'high' && !approved.has(permission.name))
      .map((permission) => permission.name);
    if (missing.length > 0) throw new AppError('PLUGIN_PERMISSION_DENIED', 'Agent 插件高风险权限未审批', { missing });
    if (record.signatureStatus === 'invalid') throw new AppError('PLUGIN_SIGNATURE_INVALID', 'Agent 插件签名无效');
    const updated = await this.repository.saveAgentPackage({ ...record, installStatus: 'enabled', updatedAt: new Date().toISOString() });
    await this.setCatalogActivation(record.tenantId, 'AGENT_DEPLOYMENT', record.id, true);
    return { ...updated, catalogEnabled: true };
  }

  async disablePackage(input: PluginEnableInput): Promise<AgentPluginPackageRecord> {
    const record = await this.requirePackage(input.pluginPackageId);
    const updated = await this.repository.saveAgentPackage({ ...record, installStatus: 'disabled', updatedAt: new Date().toISOString() });
    await this.setCatalogActivation(record.tenantId, 'AGENT_DEPLOYMENT', record.id, false);
    const mounts = await this.repository.listAgentMounts(record.tenantId);
    await Promise.all(mounts.filter((mount) => mount.pluginPackageId === record.id).map((mount) => this.repository.saveAgentMount({
      ...mount,
      status: 'DISABLED',
      updatedAt: new Date().toISOString(),
    })));
    return updated;
  }

  async listCatalog(tenantId = tenantFallback): Promise<PluginCatalogItem[]> {
    const [workflowFiles, agentPackages, activations] = await Promise.all([
      this.workflowTemplates.listFileTemplates(),
      this.listPackagesWithBuiltins(tenantId),
      this.repository.listCatalogActivations(tenantId),
    ]);
    const workflowActivation = new Map(activations
      .filter((record) => record.catalogType === 'WORKFLOW_TEMPLATE')
      .map((record) => [record.pluginId, record.status]));
    const workflowItems: PluginCatalogItem[] = workflowFiles.map((item) => {
      const metadata = item.metadata;
      return {
        id: item.id,
        catalogType: 'WORKFLOW_TEMPLATE',
        source: item.source === 'builtin' ? 'BUILTIN' : 'USER',
        name: metadata?.name ?? item.fileName,
        displayName: metadata?.displayName,
        description: metadata?.description,
        version: metadata?.version,
        status: item.valid ? workflowActivation.get(item.id) === 'enabled' ? 'enabled' : 'disabled' : 'invalid',
        platforms: (metadata?.platforms ?? []).map((platform) => platform.toUpperCase()) as PluginCatalogItem['platforms'],
        tags: metadata?.tags ?? [],
        updatedAt: item.updatedAt,
        detailRef: { workflowFileTemplateId: item.id },
      };
    });
    const agentItems: PluginCatalogItem[] = agentPackages.map((record) => ({
      id: record.id,
      catalogType: 'AGENT_DEPLOYMENT',
      source: record.id.startsWith('builtin:') ? 'BUILTIN' : 'USER',
      name: record.manifest.name,
      displayName: record.manifest.metadata?.displayName,
      description: record.manifest.metadata?.description,
      version: record.manifest.version,
      status: record.installStatus === 'pending_approval' ? 'pending_approval' : record.catalogEnabled ? 'enabled' : 'disabled',
      platforms: record.manifest.compatibility.platforms,
      tags: record.manifest.metadata?.tags ?? [],
      updatedAt: record.updatedAt,
      detailRef: { pluginPackageId: record.id, pluginVersionId: record.id },
    }));
    return [...workflowItems, ...agentItems].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async validateMount(tenantId: string, input: CreateAgentPluginMountInput) {
    const plugin = await this.requirePackage(input.pluginPackageId);
    if (plugin.tenantId !== tenantId) throw new AppError('AUTH_FORBIDDEN', '不能挂载其他租户的 Agent 插件');
    if (plugin.installStatus !== 'enabled') throw new AppError('PLUGIN_PERMISSION_DENIED', 'Agent 插件未启用');
    await this.requireCatalogEnabled(tenantId, 'AGENT_DEPLOYMENT', plugin.id);
    const compatibility = await this.validatePackageCompatibility(tenantId, input.agentId, plugin);
    return { ...compatibility, plugin };
  }

  private async validatePackageCompatibility(tenantId: string, agentId: string, plugin: AgentPluginPackageRecord) {
    assertPluginGcacCompatibility(plugin.manifest.pluginId, plugin.manifest.minGcacVersion);
    const detail = await this.agents.getAgentDetail(tenantId, agentId);
    const osType = detail.agent.descriptor.osType.toUpperCase();
    const platform = osType.includes('WINDOWS') ? 'WINDOWS' : osType.includes('LINUX') ? 'LINUX' : undefined;
    const missing: string[] = [];
    if (!platform || !plugin.manifest.compatibility.platforms.includes(platform)) missing.push(`platform:${osType}`);
    if (plugin.manifest.compatibility.architectures?.length && !plugin.manifest.compatibility.architectures.includes(detail.agent.descriptor.arch ?? '')) {
      missing.push(`arch:${detail.agent.descriptor.arch ?? 'unknown'}`);
    }
    const capabilities = new Set([
      ...(detail.capabilitySnapshot?.capabilities ?? []).map((item) => item.capabilityKey),
      ...(detail.agent.directControl?.supportedActions ?? []),
    ]);
    for (const capability of plugin.manifest.compatibility.requiredCapabilities ?? []) {
      if (!capabilities.has(capability)) missing.push(`capability:${capability}`);
    }
    return {
      compatible: missing.length === 0,
      missing,
      platform,
      agentStatus: detail.agent.status,
      capabilitySnapshot: [...capabilities],
    };
  }

  async createMount(tenantId: string, input: CreateAgentPluginMountInput): Promise<AgentPluginMount> {
    const validation = await this.validateMount(tenantId, input);
    if (!validation.compatible) throw new AppError('AGENT_PLUGIN_MOUNT_INCOMPATIBLE', 'Agent 插件与目标 Agent 不兼容', { missing: validation.missing });
    const now = new Date().toISOString();
    const mounted = validation.agentStatus === 'ONLINE';
    return this.repository.saveAgentMount({
      id: newId('agpmnt'),
      tenantId,
      agentId: input.agentId,
      pluginPackageId: validation.plugin.id,
      pluginVersionId: validation.plugin.id,
      packageHash: validation.plugin.packageHash,
      status: mounted ? 'MOUNTED' : 'PENDING_SYNC',
      compatibilitySnapshot: {
        platform: validation.platform,
        requiredCapabilities: validation.plugin.manifest.compatibility.requiredCapabilities ?? [],
        reportedCapabilities: validation.capabilitySnapshot,
      },
      permissionSnapshot: {
        permissions: validation.plugin.manifest.permissions,
        approvedPermissions: validation.plugin.approvedPermissions,
      },
      mountedAt: mounted ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  listMounts(tenantId: string, agentId?: string): Promise<AgentPluginMount[]> {
    return this.repository.listAgentMounts(tenantId, agentId);
  }

  async disableMount(tenantId: string, mountId: string): Promise<AgentPluginMount> {
    const mount = await this.requireMount(tenantId, mountId);
    return this.repository.saveAgentMount({ ...mount, status: 'DISABLED', updatedAt: new Date().toISOString() });
  }

  async deleteMount(tenantId: string, mountId: string): Promise<void> {
    await this.requireMount(tenantId, mountId);
    await this.repository.deleteAgentMount(mountId);
  }

  async previewBinding(tenantId: string, agentId: string, binding: AgentPluginBindingInput) {
    const plugin = await this.requirePackage(binding.pluginPackageId);
    assertPluginGcacCompatibility(plugin.manifest.pluginId, plugin.manifest.minGcacVersion);
    if (plugin.tenantId !== tenantId) throw new AppError('AUTH_FORBIDDEN', '不能使用其他租户的 Agent 插件');
    if (plugin.installStatus !== 'enabled') throw new AppError('PLUGIN_PERMISSION_DENIED', 'Agent 插件未启用');
    await this.requireCatalogEnabled(tenantId, 'AGENT_DEPLOYMENT', plugin.id);
    if (plugin.id !== binding.pluginVersionId) throw new AppError('AGENT_PLUGIN_BINDING_INVALID', '插件绑定版本不存在');
    if (binding.mountId) {
      const mount = await this.requireMount(tenantId, binding.mountId);
      if (mount.agentId !== agentId || mount.status !== 'MOUNTED') throw new AppError('AGENT_PLUGIN_BINDING_INVALID', '历史插件挂载对目标 Agent 不可用');
      if (mount.pluginPackageId !== binding.pluginPackageId || mount.pluginVersionId !== binding.pluginVersionId) {
        throw new AppError('AGENT_PLUGIN_BINDING_INVALID', '插件绑定版本与历史挂载版本不一致');
      }
    }
    const compatibility = await this.validatePackageCompatibility(tenantId, agentId, plugin);
    if (!compatibility.compatible) {
      throw new AppError('AGENT_PLUGIN_BINDING_INVALID', '插件与目标 Agent 不兼容', { missing: compatibility.missing });
    }
    const variables = validateAgentPluginVariableValues(plugin.manifest.variables, {
      ...(binding.variableBindings ?? {}),
      ...(binding.secretBindings ?? {}),
    });
    const missingArtifacts = Object.entries(plugin.manifest.artifactInputs)
      .filter(([, definition]) => definition.required)
      .map(([name]) => name)
      .filter((name) => !binding.certificateArtifactBindings?.[name]);
    if (missingArtifacts.length > 0) throw new AppError('AGENT_PLUGIN_BINDING_INVALID', '证书产物绑定不完整', { missingArtifacts });
    return {
      valid: true,
      pluginPackageId: plugin.id,
      pluginVersionId: plugin.id,
      variables,
      secretBindingNames: Object.keys(binding.secretBindings ?? {}),
      artifactBindingNames: Object.keys(binding.certificateArtifactBindings ?? {}),
      permissions: plugin.manifest.permissions,
      operations: plugin.manifest.operations.map(({ id, name, stage, operationType }) => ({ id, name, stage, operationType })),
      rollback: plugin.manifest.rollback?.map(({ id, name, operationType }) => ({ id, name, operationType })) ?? [],
    };
  }

  async compileExecutionPlan(input: {
    tenantId: string;
    agentId: string;
    executionRunId: string;
    executionStepId: string;
    binding: AgentPluginBindingInput;
    artifacts: Record<string, unknown>;
    executionVariables?: Record<string, unknown>;
    executionMode?: 'APPLY' | 'PREFLIGHT' | 'ROLLBACK';
    ttlSeconds?: number;
  }): Promise<AgentAtomicExecutionPlanV1> {
    await this.previewBinding(input.tenantId, input.agentId, input.binding);
    const plugin = await this.requirePackage(input.binding.pluginPackageId);
    assertPluginGcacCompatibility(plugin.manifest.pluginId, plugin.manifest.minGcacVersion);
    const variables = validateAgentPluginVariableValues(plugin.manifest.variables, {
      ...input.binding.variableBindings,
      ...input.binding.secretBindings,
      ...input.executionVariables,
    });
    const values = { variables, artifacts: normalizeBoundArtifacts(input.binding, input.artifacts) };
    const executionMode = input.executionMode ?? 'APPLY';
    const sourceOperations = executionMode === 'ROLLBACK'
      ? plugin.manifest.rollback ?? []
      : executionMode === 'PREFLIGHT'
        ? plugin.manifest.operations.filter((operation) => operation.stage === 'prepare')
        : plugin.manifest.operations;
    const operations = sourceOperations.map((operation) => ({ ...operation, input: interpolateValue(operation.input, values) as Record<string, unknown> }));
    const rollback = executionMode === 'APPLY'
      ? (plugin.manifest.rollback ?? []).map((operation) => ({ ...operation, input: interpolateValue(operation.input, values) as Record<string, unknown> }))
      : [];
    assertResolvedPermissions(plugin.manifest, [...operations, ...rollback]);
    const now = new Date();
    const ttlSeconds = Math.min(Math.max(input.ttlSeconds ?? 300, 30), 3600);
    const unsigned = {
      apiVersion: 'gcac.agent-plan/v1' as const,
      planId: newId('agplan'),
      tenantId: input.tenantId,
      agentId: input.agentId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      plugin: {
        pluginPackageId: plugin.id,
        pluginVersionId: plugin.id,
        packageHash: plugin.packageHash,
        manifestHash: hash(JSON.stringify(plugin.manifest)),
      },
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      idempotencyKey: hash(JSON.stringify({
        executionRunId: input.executionRunId,
        executionStepId: input.executionStepId,
        pluginVersionId: plugin.id,
        variables,
        artifacts: Object.keys(input.artifacts).sort(),
      })),
      permissions: plugin.manifest.permissions,
      variablesDigest: hash(JSON.stringify(variables)),
      operations,
      rollback,
    };
    const signature = createHmac('sha256', process.env.GCAC_AGENT_PLAN_SIGNING_KEY ?? 'gcac-development-agent-plan-key')
      .update(canonicalJson(unsigned))
      .digest('hex');
    return { ...unsigned, authorization: { keyId: 'agent-plan-v1', signature } };
  }

  private async requirePackage(pluginPackageId: string): Promise<AgentPluginPackageRecord> {
    const record = await this.repository.findAgentPackage(pluginPackageId);
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 插件包不存在', { pluginPackageId });
    return record;
  }

  private async ensureBuiltinPackages(tenantId: string): Promise<void> {
    const existing = new Map((await this.repository.listAgentPackages(tenantId)).map((record) => [record.manifest.pluginId, record]));
    for (const manifest of builtinAgentPluginManifests) {
      const normalized = validateAgentDeploymentPluginManifest(manifest);
      assertPluginGcacCompatibility(normalized.pluginId, normalized.minGcacVersion);
      const packageHash = hash(JSON.stringify(normalized));
      const current = existing.get(normalized.pluginId);
      if (current?.packageHash === packageHash) continue;
      const now = new Date().toISOString();
      const highRiskPermissions = normalized.permissions.filter((permission) => permission.risk === 'high').map((permission) => permission.name);
      const declaredPermissions = new Set(normalized.permissions.map((permission) => permission.name));
      const approvedPermissions = [...new Set([
        ...(current?.approvedPermissions ?? []).filter((permission) => declaredPermissions.has(permission)),
        ...normalized.permissions.filter((permission) => permission.risk !== 'high').map((permission) => permission.name),
      ])];
      const missingHighRiskPermissions = highRiskPermissions.filter((permission) => !approvedPermissions.includes(permission));
      const installStatus = current
        ? missingHighRiskPermissions.length > 0 && current.installStatus === 'enabled' ? 'pending_approval' : current.installStatus
        : missingHighRiskPermissions.length > 0 ? 'pending_approval' : 'installed_disabled';
      await this.repository.saveAgentPackage({
        id: current?.id ?? `builtin:${tenantId}:${normalized.pluginId}`,
        tenantId,
        manifest: normalized,
        packageHash,
        expectedHash: packageHash,
        signature: `${trustedMockSignaturePrefix}${packageHash}`,
        signatureStatus: 'trusted',
        installStatus,
        permissionApprovalStatus: missingHighRiskPermissions.length > 0 ? 'pending' : highRiskPermissions.length > 0 ? 'approved' : 'not_required',
        approvedPermissions,
        storageKey: `plugins/agent/builtin/${normalized.pluginId}/${normalized.version}`,
        uploadedAt: current?.uploadedAt ?? now,
        updatedAt: now,
      });
    }
  }

  private async persistUserPackage(
    manifest: AgentDeploymentPluginManifestV1,
    input: AgentPluginPackageUploadInput,
    packageHash: string,
  ): Promise<string> {
    const pluginId = safeStorageSegment(manifest.pluginId, 'pluginId');
    const version = safeStorageSegment(manifest.version, 'version');
    const versionDir = join(this.userPluginRootDir, pluginId, version);
    const metadataPath = join(versionDir, 'package-metadata.json');
    const storageKey = `agent-plugins/${pluginId}/${version}`;
    try {
      const existing = JSON.parse(await readFile(metadataPath, 'utf8')) as { packageHash?: unknown };
      if (existing.packageHash !== packageHash) {
        throw new AppError('VALIDATION_FAILED', '已存在的 Agent 插件版本内容不可覆盖', {
          pluginId: manifest.pluginId,
          version: manifest.version,
          existingPackageHash: existing.packageHash,
          packageHash,
        });
      }
      return storageKey;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (!isMissingFile(error)) throw error;
    }
    await mkdir(versionDir, { recursive: true });
    await writeAtomicFile(join(versionDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeAtomicFile(join(versionDir, 'package.bin'), input.packageContent);
    await writeAtomicFile(metadataPath, `${JSON.stringify({
      pluginId: manifest.pluginId,
      version: manifest.version,
      packageHash,
      expectedHash: input.expectedHash,
      signature: input.signature,
      storedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    return storageKey;
  }

  private async requireMount(tenantId: string, mountId: string): Promise<AgentPluginMount> {
    const mount = await this.repository.findAgentMount(mountId);
    if (!mount || mount.tenantId !== tenantId) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 插件挂载不存在', { mountId });
    return mount;
  }

  async enableWorkflowTemplatePlugin(tenantId: string, fileTemplateId: string) {
    const file = (await this.workflowTemplates.listFileTemplates()).find((item) => item.id === fileTemplateId);
    if (!file) throw new AppError('RESOURCE_NOT_FOUND', 'DSL 模板插件不存在', { fileTemplateId });
    if (!file.valid) throw new AppError('VALIDATION_FAILED', '无效的 DSL 模板插件不能启用', { fileTemplateId, error: file.error });
    return this.setCatalogActivation(tenantId, 'WORKFLOW_TEMPLATE', fileTemplateId, true);
  }

  async disableWorkflowTemplatePlugin(tenantId: string, fileTemplateId: string) {
    const file = (await this.workflowTemplates.listFileTemplates()).find((item) => item.id === fileTemplateId);
    if (!file) throw new AppError('RESOURCE_NOT_FOUND', 'DSL 模板插件不存在', { fileTemplateId });
    return this.setCatalogActivation(tenantId, 'WORKFLOW_TEMPLATE', fileTemplateId, false);
  }

  private async requireCatalogEnabled(tenantId: string, catalogType: PluginCatalogActivationType, pluginId: string): Promise<void> {
    const activation = await this.repository.findCatalogActivation(tenantId, catalogType, pluginId);
    if (activation?.status !== 'enabled') throw new AppError('PLUGIN_PERMISSION_DENIED', '插件未手动启用', { catalogType, pluginId });
  }

  private setCatalogActivation(tenantId: string, catalogType: PluginCatalogActivationType, pluginId: string, enabled: boolean) {
    const now = new Date().toISOString();
    return this.repository.saveCatalogActivation({
      id: `catalog-activation:${hash(`${tenantId}:${catalogType}:${pluginId}`)}`,
      tenantId,
      catalogType,
      pluginId,
      status: enabled ? 'enabled' : 'disabled',
      enabledAt: enabled ? now : undefined,
      updatedAt: now,
    });
  }
}

function normalizeBoundArtifacts(binding: AgentPluginBindingInput, artifacts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(binding.certificateArtifactBindings ?? {}).map(([name, definition]) => {
    const material = isRecord(artifacts[name]) ? artifacts[name] : {};
    const outputs = isRecord(material.outputs) ? material.outputs : {};
    const selectedBySlot = Object.fromEntries(Object.entries(definition.outputBindings)
      .map(([slot, outputKey]) => [slot, outputs[outputKey]] as const)
      .filter(([, value]) => value !== undefined));
    const selected = Object.values(selectedBySlot);
    const primary = selected.length === 1 && isRecord(selected[0]) ? selected[0] : {};
    return [name, { ...material, ...primary, ...selectedBySlot }];
  }));
}

function safeStorageSegment(value: string, field: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new AppError('VALIDATION_FAILED', `Agent 插件 ${field} 不能用于存储路径`, { field, value });
  }
  return value;
}

async function writeAtomicFile(targetPath: string, content: string): Promise<void> {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, targetPath);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
}

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function verifyMockSignature(signature: string | undefined, packageHash: string): AgentPluginPackageRecord['signatureStatus'] {
  if (!signature) return 'missing';
  if (signature === `${trustedMockSignaturePrefix}${packageHash}`) return 'trusted';
  if (signature.startsWith('mock-untrusted:')) return 'untrusted';
  return 'invalid';
}

function interpolateValue(value: unknown, context: { variables: Record<string, unknown>; artifacts: Record<string, unknown> }): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\$\{(variables|artifacts)\.([A-Za-z_][A-Za-z0-9_.-]*)\}$/);
    if (exact) return resolveContextPath(context[exact[1] as 'variables' | 'artifacts'], exact[2]);
    return value.replace(/\$\{(variables|artifacts)\.([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_, group: 'variables' | 'artifacts', key: string) => String(resolveContextPath(context[group], key) ?? ''));
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, context));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, interpolateValue(item, context)] as const)
    .filter(([, item]) => item !== undefined));
  return value;
}

function resolveContextPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => isRecord(current) ? current[segment] : undefined, root);
}

function assertResolvedPermissions(manifest: AgentDeploymentPluginManifestV1, operations: Array<{ operationType: string; input: Record<string, unknown> }>): void {
  const byScope = new Map<string, string[]>();
  for (const permission of manifest.permissions) byScope.set(permission.scope, [...(byScope.get(permission.scope) ?? []), ...permission.values]);
  for (const operation of operations) {
    if (operation.operationType.startsWith('file.')) {
      const path = stringValue(operation.input.path) ?? stringValue(operation.input.targetPath);
      if (path && !matchesPermission(path, byScope.get('filesystem') ?? [])) throw new AppError('PLUGIN_PERMISSION_DENIED', '文件路径超出插件权限', { path });
    }
    if (operation.operationType === 'command.execute') {
      const program = stringValue(operation.input.program);
      if (!program || !matchesPermission(program, byScope.get('process') ?? [])) throw new AppError('PLUGIN_PERMISSION_DENIED', '程序超出插件权限', { program });
    }
    if (operation.operationType === 'service.control') {
      const service = stringValue(operation.input.serviceName) ?? stringValue(operation.input.service);
      if (!service || !matchesPermission(service, byScope.get('service') ?? [])) throw new AppError('PLUGIN_PERMISSION_DENIED', '服务超出插件权限', { service });
    }
    if (operation.operationType === 'tls.verify') {
      const host = stringValue(operation.input.host);
      const port = typeof operation.input.port === 'number' ? operation.input.port : undefined;
      const target = host && port ? `${host}:${port}` : host;
      if (target && !matchesPermission(target, byScope.get('network') ?? [])) throw new AppError('PLUGIN_PERMISSION_DENIED', '网络目标超出插件权限', { target });
    }
    if (operation.operationType.startsWith('windows.certificate')) {
      const store = stringValue(operation.input.store) ?? 'LocalMachine/My';
      if (!matchesPermission(store, byScope.get('certificate_store') ?? [])) {
        throw new AppError('PLUGIN_PERMISSION_DENIED', 'Windows 证书库超出插件权限', { store });
      }
    }
    if (operation.operationType.startsWith('windows.iis.')) {
      const siteName = stringValue(operation.input.siteName);
      if (!siteName || !matchesPermission(siteName, byScope.get('iis') ?? [])) {
        throw new AppError('PLUGIN_PERMISSION_DENIED', 'IIS Site 超出插件权限', { siteName });
      }
    }
  }
}

function matchesPermission(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pattern === value || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
