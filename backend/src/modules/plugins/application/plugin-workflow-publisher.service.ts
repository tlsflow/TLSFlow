import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { WorkflowDslV1 } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { PluginWorkflowBindingRecord } from '../dto/plugin-workflow-bindings.dto.js';
import { PluginWorkflowBindingsRepository, type PluginWorkflowBindingsRepositoryPort } from '../repository/plugin-workflow-bindings.repository.js';

export class PluginWorkflowPublisherService {
  constructor(
    private readonly workflows: WorkflowTemplatesApplicationService,
    private readonly repository: PluginWorkflowBindingsRepositoryPort = new PluginWorkflowBindingsRepository(),
  ) {}

  async publishPlugin(record: UnifiedPluginVersionRecord): Promise<PluginWorkflowBindingRecord[]> {
    if (record.runtime !== 'WORKFLOW_DSL') return [];
    const output: PluginWorkflowBindingRecord[] = [];
    for (const [capabilityKey, resourcePath] of Object.entries(record.manifest.resources.workflows ?? {})) {
      const existing = await this.repository.find(record.id, capabilityKey);
      if (existing) {
        this.assertSameResource(record, capabilityKey, resourcePath, existing);
        output.push(existing);
        continue;
      }
      const shared = await this.repository.findByResource(record.id, resourcePath);
      if (shared) {
        output.push(await this.repository.save({ ...shared, capabilityKey }));
        continue;
      }
      const contentText = record.resources[resourcePath];
      if (!contentText) throw new AppError('VALIDATION_FAILED', '插件 Workflow 资源不存在', { pluginVersionId: record.id, capabilityKey, resourcePath });
      const content = JSON.parse(contentText) as WorkflowDslV1;
      const created = await this.workflows.createTemplate({ content, changeSummary: `由插件 ${record.pluginId}@${record.version} 发布` });
      const published = await this.workflows.publishVersion(created.version.id);
      output.push(await this.repository.save({
        pluginVersionId: record.id,
        capabilityKey,
        workflowResourcePath: resourcePath,
        workflowTemplateId: created.template.id,
        workflowVersionId: published.id,
        workflowContentSha256: sha256(contentText),
        createdAt: new Date().toISOString(),
      }));
    }
    return output;
  }

  async require(pluginVersionId: string, capabilityKey: string): Promise<PluginWorkflowBindingRecord> {
    const binding = await this.repository.find(pluginVersionId, capabilityKey);
    if (!binding) throw new AppError('RESOURCE_NOT_FOUND', '插件能力没有已发布的 Workflow 绑定', { pluginVersionId, capabilityKey });
    return binding;
  }

  private assertSameResource(record: UnifiedPluginVersionRecord, capabilityKey: string, resourcePath: string, existing: PluginWorkflowBindingRecord): void {
    const content = record.resources[resourcePath];
    if (existing.workflowResourcePath !== resourcePath || !content || existing.workflowContentSha256 !== sha256(content)) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布插件版本的 Workflow 绑定不可覆盖', { pluginVersionId: record.id, capabilityKey });
    }
  }
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
