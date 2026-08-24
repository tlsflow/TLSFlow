import { AppError } from '../../../common/errors/app-error.js';
import { compareSemanticVersions } from '../../plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { PluginWorkflowBindingsRepository } from '../../plugins/repository/plugin-workflow-bindings.repository.js';
import type { CreateWorkflowDraftFromPluginInput, CreateWorkflowFromPluginInput, WorkflowPluginSource, WorkflowSourceCandidate } from '../dto/workflow-templates.dto.js';
import type { WorkflowTemplatesApplicationService } from './workflow-templates.application-service.js';

const allowedCapabilities = new Set(['certificate.deploy', 'certificate.rollback']);

export class PluginWorkflowSourceService {
  constructor(
    private readonly plugins: UnifiedPluginsApplicationService,
    private readonly bindings: PluginWorkflowBindingsRepository,
    private readonly workflows: WorkflowTemplatesApplicationService,
    /** @deprecated 内置资源不再通过默认租户授权，此参数仅保留构造兼容。 */
    _legacyBuiltinTenantId?: string,
  ) {}

  async list(tenantId: string, locale = 'zh-CN'): Promise<WorkflowSourceCandidate[]> {
    const versions = this.accessibleWorkflowVersions(tenantId, await this.listAccessibleVersions(tenantId));
    const output: WorkflowSourceCandidate[] = [];
    for (const plugin of versions) {
      if (plugin.status !== 'ENABLED' || plugin.runtime !== 'WORKFLOW_DSL') continue;
      const uiResources = await this.plugins.getUiResources(plugin.id, locale);
      const displayName = uiResources.locale?.messages[plugin.manifest.displayNameKey] ?? plugin.manifest.displayNameKey;
      const pluginBindings = await this.bindings.list(plugin.id);
      const bindingsByWorkflow = new Map<string, typeof pluginBindings>();
      for (const binding of pluginBindings) {
        if (!allowedCapabilities.has(binding.capabilityKey)) continue;
        const key = `${binding.workflowResourcePath}:${binding.workflowVersionId}`;
        bindingsByWorkflow.set(key, [...(bindingsByWorkflow.get(key) ?? []), binding]);
      }
      for (const sourceBindings of bindingsByWorkflow.values()) {
        const binding = sourceBindings.find((item) => item.capabilityKey === 'certificate.deploy') ?? sourceBindings[0]!;
        const source = await this.workflows.getVersion(binding.workflowVersionId).catch(() => undefined);
        if (!source || source.status !== 'published' || source.contentHash !== binding.workflowContentSha256) continue;
        output.push({
          pluginId: plugin.pluginId,
          pluginVersionId: plugin.id,
          pluginVersion: plugin.version,
          displayName,
          capabilityKey: binding.capabilityKey as WorkflowSourceCandidate['capabilityKey'],
          workflowTemplateId: binding.workflowTemplateId,
          workflowVersionId: binding.workflowVersionId,
          workflowContentHash: binding.workflowContentSha256,
          workflowVersion: source.version,
          stepCount: source.content.steps.length,
          rollbackCount: source.content.rollback?.length ?? 0,
        });
      }
    }
    return output.sort((left, right) => left.pluginId.localeCompare(right.pluginId) || left.capabilityKey.localeCompare(right.capabilityKey));
  }

  async createWorkflow(tenantId: string, input: CreateWorkflowFromPluginInput) {
    const source = await this.requireSource(tenantId, input.pluginVersionId, input.capabilityKey);
    const pluginSource = pluginSourceOf(source.plugin.pluginId, input.pluginVersionId, input.capabilityKey, source.version.id, source.version.contentHash);
    const content = structuredClone(source.version.content);
    content.metadata.name = input.name.trim();
    if (!content.metadata.name) throw new AppError('VALIDATION_FAILED', '工作流名称不能为空');
    return this.workflows.createWorkflow({ content, changeSummary: input.changeSummary, pluginSource }, tenantId);
  }

  async createDraft(tenantId: string, input: CreateWorkflowDraftFromPluginInput) {
    const target = (await this.workflows.listUserWorkflows(tenantId)).find((item) => item.id === input.templateId);
    if (!target) throw new AppError('RESOURCE_NOT_FOUND', '目标工作流不存在或不可作为草稿来源', { templateId: input.templateId });
    const source = await this.requireSource(tenantId, input.pluginVersionId, input.capabilityKey);
    const content = structuredClone(source.version.content);
    content.metadata.name = target.name;
    return this.workflows.createDraftFromPluginCapability({
      templateId: target.id,
      content,
      changeSummary: input.changeSummary,
      pluginSource: pluginSourceOf(source.plugin.pluginId, input.pluginVersionId, input.capabilityKey, source.version.id, source.version.contentHash),
    });
  }

  private async requireSource(tenantId: string, pluginVersionId: string, capabilityKey: string) {
    if (!allowedCapabilities.has(capabilityKey)) throw new AppError('PLUGIN_WORKFLOW_CAPABILITY_NOT_ALLOWED', '只允许从证书部署或回滚能力创建工作流', { capabilityKey });
    const plugin = await this.plugins.getVersion(pluginVersionId);
    if (!this.isAccessible(plugin, tenantId) || plugin.status !== 'ENABLED' || plugin.runtime !== 'WORKFLOW_DSL') {
      throw new AppError('PLUGIN_WORKFLOW_SOURCE_UNAVAILABLE', '插件版本不能作为工作流来源', { pluginVersionId });
    }
    const binding = await this.bindings.find(pluginVersionId, capabilityKey);
    if (!binding) throw new AppError('PLUGIN_WORKFLOW_BINDING_MISSING', '插件能力缺少工作流绑定', { pluginVersionId, capabilityKey });
    const version = await this.workflows.getVersion(binding.workflowVersionId);
    if (version.status !== 'published') throw new AppError('PLUGIN_WORKFLOW_SOURCE_UNAVAILABLE', '插件工作流版本尚未发布', { workflowVersionId: version.id });
    if (version.contentHash !== binding.workflowContentSha256) throw new AppError('PLUGIN_WORKFLOW_HASH_MISMATCH', '插件工作流绑定哈希与版本内容不一致', { workflowVersionId: version.id });
    return { plugin, binding, version };
  }

  private async listAccessibleVersions(tenantId: string) {
    const currentTenantVersions = await this.plugins.listVersions(tenantId);
    const builtinVersions = await this.plugins.listBuiltinVersions();
    return [
      ...currentTenantVersions,
      ...builtinVersions,
    ];
  }

  private accessibleWorkflowVersions(
    tenantId: string,
    versions: Awaited<ReturnType<UnifiedPluginsApplicationService['listVersions']>>,
  ) {
    const current = new Map<string, { plugin: typeof versions[number]; priority: number }>();
    for (const plugin of versions) {
      if (plugin.status !== 'ENABLED' || plugin.runtime !== 'WORKFLOW_DSL') continue;
      const priority = plugin.tenantId === tenantId ? 1 : 0;
      const key = `${plugin.pluginId}@${plugin.version}`;
      const previous = current.get(key);
      if (
        !previous
        || priority > previous.priority
        || (priority === previous.priority && compareSemanticVersions(plugin.version, previous.plugin.version) > 0)
      ) {
        current.set(key, { plugin, priority });
      }
    }
    return [...current.values()]
      .map((item) => item.plugin)
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId) || compareSemanticVersions(right.version, left.version));
  }

  private isAccessible(plugin: Awaited<ReturnType<UnifiedPluginsApplicationService['getVersion']>>, tenantId: string): boolean {
    return plugin.tenantId === tenantId
      || plugin.source === 'BUILTIN';
  }
}

function pluginSourceOf(
  pluginId: string,
  pluginVersionId: string,
  capabilityKey: CreateWorkflowFromPluginInput['capabilityKey'],
  sourceWorkflowVersionId: string,
  sourceContentHash: string,
): WorkflowPluginSource {
  return { sourceType: 'PLUGIN_CAPABILITY', pluginId, pluginVersionId, capabilityKey, sourceWorkflowVersionId, sourceContentHash, createdAt: new Date().toISOString() };
}
