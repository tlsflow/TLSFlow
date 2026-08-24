import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { PluginWorkflowBindingsRepository } from '../../plugins/repository/plugin-workflow-bindings.repository.js';
import type { CreateWorkflowDraftFromPluginInput, CreateWorkflowFromPluginInput, WorkflowSourceCandidate, WorkflowTemplateProvenance } from '../dto/workflow-templates.dto.js';
import type { WorkflowTemplatesApplicationService } from './workflow-templates.application-service.js';

const allowedCapabilities = new Set(['certificate.deploy', 'certificate.rollback']);

export class PluginWorkflowSourceService {
  constructor(
    private readonly plugins: UnifiedPluginsApplicationService,
    private readonly bindings: PluginWorkflowBindingsRepository,
    private readonly workflows: WorkflowTemplatesApplicationService,
  ) {}

  async list(tenantId: string): Promise<WorkflowSourceCandidate[]> {
    const versions = await this.plugins.listVersions(tenantId);
    const output: WorkflowSourceCandidate[] = [];
    for (const plugin of versions) {
      if (plugin.status !== 'ENABLED' || plugin.runtime !== 'WORKFLOW_DSL') continue;
      for (const binding of await this.bindings.list(plugin.id)) {
        if (!allowedCapabilities.has(binding.capabilityKey)) continue;
        const source = await this.workflows.getVersion(binding.workflowVersionId).catch(() => undefined);
        if (!source || source.status !== 'published' || source.contentHash !== binding.workflowContentSha256) continue;
        output.push({
          pluginId: plugin.pluginId,
          pluginVersionId: plugin.id,
          pluginVersion: plugin.version,
          displayName: plugin.manifest.displayNameKey,
          capabilityKey: binding.capabilityKey as WorkflowSourceCandidate['capabilityKey'],
          workflowTemplateId: binding.workflowTemplateId,
          workflowVersionId: binding.workflowVersionId,
          workflowContentHash: binding.workflowContentSha256,
          stepCount: source.content.steps.length,
          rollbackCount: source.content.rollback?.length ?? 0,
        });
      }
    }
    return output.sort((left, right) => left.pluginId.localeCompare(right.pluginId) || left.capabilityKey.localeCompare(right.capabilityKey));
  }

  async createWorkflow(tenantId: string, input: CreateWorkflowFromPluginInput) {
    const source = await this.requireSource(tenantId, input.pluginVersionId, input.capabilityKey);
    const provenance = provenanceOf(source.plugin.pluginId, input.pluginVersionId, input.capabilityKey, source.binding.workflowTemplateId, source.version.id, source.version.contentHash);
    const content = structuredClone(source.version.content);
    content.metadata.name = input.name.trim();
    if (!content.metadata.name) throw new AppError('VALIDATION_FAILED', '工作流名称不能为空');
    return this.workflows.createPluginDerivedWorkflow({ content, changeSummary: input.changeSummary, provenance });
  }

  async createDraft(tenantId: string, input: CreateWorkflowDraftFromPluginInput) {
    const target = (await this.workflows.listTemplates()).find((item) => item.id === input.templateId);
    if (!target) throw new AppError('RESOURCE_NOT_FOUND', '目标工作流不存在', { templateId: input.templateId });
    if (target.origin !== 'user' && target.origin !== 'plugin_derived') throw new AppError('WORKFLOW_INTERNAL_READ_ONLY', '插件内部工作流不能套用来源');
    const source = await this.requireSource(tenantId, input.pluginVersionId, input.capabilityKey);
    const content = structuredClone(source.version.content);
    content.metadata.name = target.name;
    return this.workflows.createDraftFromPluginCapability({ templateId: target.id, content, changeSummary: input.changeSummary });
  }

  private async requireSource(tenantId: string, pluginVersionId: string, capabilityKey: string) {
    if (!allowedCapabilities.has(capabilityKey)) throw new AppError('PLUGIN_WORKFLOW_CAPABILITY_NOT_ALLOWED', '只允许从证书部署或回滚能力创建工作流', { capabilityKey });
    const plugin = await this.plugins.getVersion(pluginVersionId);
    if (plugin.tenantId !== tenantId || plugin.status !== 'ENABLED' || plugin.runtime !== 'WORKFLOW_DSL') throw new AppError('PLUGIN_WORKFLOW_SOURCE_UNAVAILABLE', '插件版本不能作为工作流来源', { pluginVersionId });
    const binding = await this.bindings.find(pluginVersionId, capabilityKey);
    if (!binding) throw new AppError('PLUGIN_WORKFLOW_BINDING_MISSING', '插件能力缺少工作流绑定', { pluginVersionId, capabilityKey });
    const version = await this.workflows.getVersion(binding.workflowVersionId);
    if (version.status !== 'published') throw new AppError('PLUGIN_WORKFLOW_SOURCE_UNAVAILABLE', '插件工作流版本尚未发布', { workflowVersionId: version.id });
    if (version.contentHash !== binding.workflowContentSha256) throw new AppError('PLUGIN_WORKFLOW_HASH_MISMATCH', '插件工作流绑定哈希与版本内容不一致', { workflowVersionId: version.id });
    return { plugin, binding, version };
  }
}

function provenanceOf(pluginId: string, pluginVersionId: string, capabilityKey: CreateWorkflowFromPluginInput['capabilityKey'], sourceWorkflowTemplateId: string, sourceWorkflowVersionId: string, sourceContentHash: string): WorkflowTemplateProvenance {
  return { sourceType: 'PLUGIN_CAPABILITY', pluginId, pluginVersionId, capabilityKey, sourceWorkflowTemplateId, sourceWorkflowVersionId, sourceContentHash, createdAt: new Date().toISOString() };
}
