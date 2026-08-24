import { AppError } from '../../../common/errors/app-error.js';
import type { WorkflowDslV1 } from '../../workflow-templates/dto/workflow-templates.dto.js';
import { computeWorkflowContentHash } from '../../workflow-templates/domain/workflow-templates.domain-service.js';
import { workflowTemplatesSchemaRegistry } from '../../workflow-templates/schema/workflow-templates.schema.js';
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
    this.assertSharedBranchResource(record);
    const output: PluginWorkflowBindingRecord[] = [];
    for (const [capabilityKey, resourcePath] of Object.entries(record.manifest.resources.workflows ?? {})) {
      const existing = await this.repository.find(record.id, capabilityKey);
      if (existing) {
        this.assertSameResource(record, capabilityKey, resourcePath, existing);
        await this.repairLegacyBuiltinTemplate(record, existing.workflowTemplateId);
        output.push(existing);
        continue;
      }
      const shared = await this.repository.findByResource(record.id, resourcePath);
      if (shared) {
        await this.repairLegacyBuiltinTemplate(record, shared.workflowTemplateId);
        output.push(await this.repository.save({ ...shared, capabilityKey, ownerType: ownerTypeOf(record), ownerId: ownerIdOf(record) }));
        continue;
      }
      const contentText = record.resources[resourcePath];
      if (!contentText) throw new AppError('VALIDATION_FAILED', '插件 Workflow 资源不存在', { pluginVersionId: record.id, capabilityKey, resourcePath });
      const content = workflowTemplatesSchemaRegistry.validate(JSON.parse(contentText) as WorkflowDslV1);
      const contentSha256 = computeWorkflowContentHash(content);
      const previous = await this.repository.findLatestByPluginResource(record.tenantId, record.pluginId, resourcePath);
      if (previous) await this.repairLegacyBuiltinTemplate(record, previous.workflowTemplateId);
      const published = previous?.workflowContentSha256 === contentSha256
        ? { templateId: previous.workflowTemplateId, versionId: previous.workflowVersionId, contentHash: previous.workflowContentSha256 }
        : await this.publishWorkflowVersion(record, content, previous);
      output.push(await this.repository.save({
        pluginVersionId: record.id,
        capabilityKey,
        workflowResourcePath: resourcePath,
        workflowTemplateId: published.templateId,
        workflowVersionId: published.versionId,
        workflowContentSha256: contentSha256,
        ownerType: ownerTypeOf(record),
        ...(ownerIdOf(record) ? { ownerId: ownerIdOf(record) } : {}),
        createdAt: new Date().toISOString(),
      }));
    }
    return output;
  }

  private async repairLegacyBuiltinTemplate(record: UnifiedPluginVersionRecord, templateId: string): Promise<void> {
    if (record.source !== 'BUILTIN' || ownerTypeOf(record) !== 'SYSTEM') return;
    await this.workflows.promoteLegacyPluginTemplate(templateId);
  }

  async require(pluginVersionId: string, capabilityKey: string): Promise<PluginWorkflowBindingRecord> {
    const binding = await this.repository.find(pluginVersionId, capabilityKey);
    if (!binding) throw new AppError('RESOURCE_NOT_FOUND', '插件能力没有已发布的 Workflow 绑定', { pluginVersionId, capabilityKey });
    return binding;
  }

  private assertSameResource(record: UnifiedPluginVersionRecord, capabilityKey: string, resourcePath: string, existing: PluginWorkflowBindingRecord): void {
    const content = record.resources[resourcePath];
    if (!content) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布插件版本的 Workflow 绑定不可覆盖', { pluginVersionId: record.id, capabilityKey });
    }
    const parsed = workflowTemplatesSchemaRegistry.validate(JSON.parse(content) as WorkflowDslV1);
    if (existing.workflowResourcePath !== resourcePath || existing.workflowContentSha256 !== computeWorkflowContentHash(parsed)) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布插件版本的 Workflow 绑定不可覆盖', { pluginVersionId: record.id, capabilityKey });
    }
  }

  private assertSharedBranchResource(record: UnifiedPluginVersionRecord): void {
    const deployPath = record.manifest.resources.workflows?.['certificate.deploy'];
    const rollbackPath = record.manifest.resources.workflows?.['certificate.rollback'];
    if (deployPath && rollbackPath && deployPath !== rollbackPath) {
      throw new AppError('VALIDATION_FAILED', '插件的 certificate.deploy 与 certificate.rollback 必须指向同一 Workflow DSL 资源', {
        pluginVersionId: record.id,
        deployPath,
        rollbackPath,
      });
    }
  }

  private async publishWorkflowVersion(
    record: UnifiedPluginVersionRecord,
    content: WorkflowDslV1,
    previous: PluginWorkflowBindingRecord | undefined,
  ): Promise<{ templateId: string; versionId: string; contentHash: string }> {
    const changeSummary = `由插件 ${record.pluginId}@${record.version} 发布`;
    if (!previous) {
      const created = await this.workflows.createPluginTemplate({ content, changeSummary }, {
        ownerType: ownerTypeOf(record),
        ownerId: ownerIdOf(record),
        tenantId: record.tenantId,
      });
      const published = await this.workflows.publishPluginVersion(created.version.id);
      return { templateId: created.template.id, versionId: published.id, contentHash: published.contentHash };
    }
    const draft = await this.workflows.createPluginInternalDraftVersion({
      templateId: previous.workflowTemplateId,
      content,
      changeSummary,
    });
    const published = await this.workflows.publishPluginVersion(draft.id);
    return { templateId: previous.workflowTemplateId, versionId: published.id, contentHash: published.contentHash };
  }
}

function ownerTypeOf(record: UnifiedPluginVersionRecord): 'SYSTEM' | 'TENANT' {
  return record.ownerType ?? (record.source === 'BUILTIN' ? 'SYSTEM' : 'TENANT');
}

function ownerIdOf(record: UnifiedPluginVersionRecord): string | undefined {
  return record.ownerId ?? (ownerTypeOf(record) === 'TENANT' ? record.tenantId : undefined);
}
