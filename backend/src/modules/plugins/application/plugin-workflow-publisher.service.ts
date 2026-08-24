import { AppError } from '../../../common/errors/app-error.js';
import type { WorkflowDslV1 } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { WorkflowTemplateVersion } from '../../workflow-templates/dto/workflow-templates.dto.js';
import { computeWorkflowContentHash } from '../../workflow-templates/domain/workflow-templates.domain-service.js';
import { workflowTemplatesSchemaRegistry } from '../../workflow-templates/schema/workflow-templates.schema.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { PluginWorkflowBindingRecord } from '../dto/plugin-workflow-bindings.dto.js';
import { PluginWorkflowBindingsRepository, type PluginWorkflowBindingsRepositoryPort } from '../repository/plugin-workflow-bindings.repository.js';
import {
  isPluginWorkflowResource,
} from '../schema/plugin-workflow.schema.js';
import {
  resolveManifestWorkflowDeclarations,
  type PluginWorkflowDeclaration,
  type PluginWorkflowDeclarationResolver,
} from './plugin-workflow-declaration-resolver.js';
import { certificateUpdatePluginIds } from '../canonical-plugin-id/canonical-plugin-id.registry.js';

export class PluginWorkflowPublisherService {
  constructor(
    private readonly workflows: WorkflowTemplatesApplicationService,
    private readonly repository: PluginWorkflowBindingsRepositoryPort = new PluginWorkflowBindingsRepository(),
    private readonly declarationResolver?: PluginWorkflowDeclarationResolver,
  ) {}

  async publishPlugin(record: UnifiedPluginVersionRecord): Promise<PluginWorkflowBindingRecord[]> {
    if (record.runtime !== 'WORKFLOW_DSL') return [];
    this.assertSharedBranchResource(record);
    this.assertCredentialAcquireContract(record);
    const declarations = this.workflowDeclarationsFor(record);
    const output: PluginWorkflowBindingRecord[] = [];
    for (const declaration of declarations) {
      const { capabilityKey, key: workflowKey, path: resourcePath } = declaration;
      const existing = await this.repository.find(record.id, capabilityKey, workflowKey);
      const contentText = record.resources[resourcePath];
      if (!contentText) throw new AppError('VALIDATION_FAILED', '插件 Workflow 资源不存在', { pluginVersionId: record.id, capabilityKey, workflowKey, resourcePath });
      const parsed = this.parseWorkflow(record, capabilityKey, contentText);
      const contentSha256 = computeWorkflowContentHash(parsed.content);
      if (existing) {
        const repaired = await this.repairStaleBinding(
          record,
          capabilityKey,
          workflowKey,
          resourcePath,
          parsed.content,
          contentSha256,
          existing,
        );
        if (repaired) {
          output.push(repaired);
          continue;
        }
        this.assertSameResource(record.id, capabilityKey, workflowKey, resourcePath, contentSha256, existing);
        await this.assertPublishedBinding(existing, record.id, capabilityKey, record.version);
        output.push(existing);
        continue;
      }
      const shared = capabilityKey === 'credential.acquire'
        ? undefined
        : await this.repository.findByResource(record.id, resourcePath);
      if (shared) {
        const repaired = await this.repairStaleBinding(
          record,
          capabilityKey,
          workflowKey,
          resourcePath,
          parsed.content,
          contentSha256,
          shared,
        );
        if (repaired) {
          output.push(repaired);
          continue;
        }
        this.assertSameResource(record.id, capabilityKey, workflowKey, resourcePath, contentSha256, shared);
        await this.assertPublishedBinding(shared, record.id, capabilityKey, record.version);
        output.push(await this.repository.save({ ...shared, capabilityKey, workflowKey, ownerType: ownerTypeOf(record), ownerId: ownerIdOf(record) }));
        continue;
      }
      const previous = await this.repository.findLatestByPluginResource(
        record.tenantId,
        record.pluginId,
        resourcePath,
        capabilityKey,
        workflowKey,
      );
      const published = previous?.workflowContentSha256 === contentSha256
        ? await this.reusePublishedBinding(previous, record.id, capabilityKey, record.version)
        : await this.publishWorkflowVersion(record, parsed.content, previous);
      output.push(await this.repository.save({
        pluginVersionId: record.id,
        capabilityKey,
        workflowKey,
        workflowResourcePath: resourcePath,
        workflowTemplateId: published.templateId,
        workflowVersionId: published.versionId,
        workflowContentSha256: contentSha256,
        ownerType: ownerTypeOf(record),
        ...(ownerIdOf(record) ? { ownerId: ownerIdOf(record) } : {}),
        createdAt: new Date().toISOString(),
      }));
    }
    const expectedCapabilityKeys = record.manifest.capabilities.map((capability) => capability.key);
    const publishedCapabilityKeys = new Set(output.map((binding) => binding.capabilityKey));
    const missingCapabilityKeys = expectedCapabilityKeys.filter((capabilityKey) => !publishedCapabilityKeys.has(capabilityKey));
    if (missingCapabilityKeys.length > 0) {
      throw new AppError('VALIDATION_FAILED', '插件 Workflow 绑定未完整发布', {
        pluginVersionId: record.id,
        missingCapabilityKeys,
      });
    }
    return output;
  }

  async require(pluginVersionId: string, capabilityKey: string, workflowKey?: string): Promise<PluginWorkflowBindingRecord> {
    const binding = await this.repository.find(pluginVersionId, capabilityKey, workflowKey);
    if (!binding) throw new AppError('RESOURCE_NOT_FOUND', '插件能力没有已发布的 Workflow 绑定', { pluginVersionId, capabilityKey, workflowKey });
    return binding;
  }

  private workflowDeclarationsFor(record: UnifiedPluginVersionRecord): PluginWorkflowDeclaration[] {
    const resolved = this.declarationResolver?.(record.pluginId, record.version);
    // 只有固定 Registry 明确声明了该插件时才使用它；用户插件或旧插件
    // 不在 Registry 中，继续按已验证的 Manifest 资源声明发布。
    const declarations = resolved
      ? [...resolved]
      : resolveManifestWorkflowDeclarations(record);
    const resources = record.manifest.resources.workflows ?? {};
    const capabilities = new Set(record.manifest.capabilities.map((capability) => capability.key));
    const workflowKeys = new Set<string>();
    for (const declaration of declarations) {
      if (workflowKeys.has(declaration.key)) {
        throw new AppError('VALIDATION_FAILED', '插件 Workflow 声明存在重复 workflowKey', { pluginVersionId: record.id, workflowKey: declaration.key });
      }
      workflowKeys.add(declaration.key);
      if (!capabilities.has(declaration.capabilityKey)) {
        throw new AppError('VALIDATION_FAILED', '插件 Workflow 声明引用未声明 Capability', {
          pluginVersionId: record.id,
          workflowKey: declaration.key,
          capabilityKey: declaration.capabilityKey,
        });
      }
      if (resources[declaration.key] !== declaration.path) {
        throw new AppError('VALIDATION_FAILED', '插件 Workflow 声明与 Manifest 资源路径不一致', {
          pluginVersionId: record.id,
          workflowKey: declaration.key,
          declaredPath: declaration.path,
          manifestPath: resources[declaration.key],
        });
      }
    }
    const declaredKeys = new Set(declarations.map((declaration) => declaration.key));
    const missingDeclarations = Object.keys(resources).filter((key) => !declaredKeys.has(key));
    if (missingDeclarations.length > 0) {
      throw new AppError('VALIDATION_FAILED', '插件 Manifest Workflow 缺少固定发布声明', {
        pluginVersionId: record.id,
        missingWorkflowKeys: missingDeclarations,
      });
    }
    return declarations;
  }

  private assertSameResource(
    pluginVersionId: string,
    capabilityKey: string,
    workflowKey: string,
    resourcePath: string,
    contentSha256: string,
    existing: PluginWorkflowBindingRecord,
  ): void {
    if (existing.workflowResourcePath !== resourcePath || existing.workflowContentSha256 !== contentSha256) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布插件版本的 Workflow 绑定不可覆盖', { pluginVersionId, capabilityKey, workflowKey });
    }
  }

  private async reusePublishedBinding(
    binding: PluginWorkflowBindingRecord,
    pluginVersionId: string,
    capabilityKey: string,
    expectedWorkflowVersion: string,
  ): Promise<{ templateId: string; versionId: string; contentHash: string }> {
    await this.assertPublishedBinding(binding, pluginVersionId, capabilityKey, expectedWorkflowVersion);
    return {
      templateId: binding.workflowTemplateId,
      versionId: binding.workflowVersionId,
      contentHash: binding.workflowContentSha256,
    };
  }

  /**
   * 修复历史上“插件版本已升级、绑定仍指向旧 DSL 版本”的派生记录。
   * 只有绑定资源路径一致且目标版本本身可核验时才允许自动修复；其他
   * 摘要或目标完整性问题仍然走冲突保护，避免把损坏数据静默覆盖。
   */
  private async repairStaleBinding(
    record: UnifiedPluginVersionRecord,
    capabilityKey: string,
    workflowKey: string,
    resourcePath: string,
    content: WorkflowDslV1,
    contentSha256: string,
    binding: PluginWorkflowBindingRecord,
  ): Promise<PluginWorkflowBindingRecord | undefined> {
    if (binding.workflowResourcePath !== resourcePath) return undefined;
    const version = await this.getPublishedBinding(binding, record.id, capabilityKey);
    if (version.content.metadata.version === record.version) return undefined;

    const published = await this.publishWorkflowVersion(record, content, binding);
    return this.repository.save({
      ...binding,
      pluginVersionId: record.id,
      capabilityKey,
      workflowKey,
      workflowResourcePath: resourcePath,
      workflowTemplateId: published.templateId,
      workflowVersionId: published.versionId,
      workflowContentSha256: contentSha256,
      ownerType: ownerTypeOf(record),
      ownerId: ownerIdOf(record),
      createdAt: binding.createdAt,
    });
  }

  private async assertPublishedBinding(
    binding: PluginWorkflowBindingRecord,
    pluginVersionId?: string,
    capabilityKey?: string,
    expectedWorkflowVersion?: string,
  ): Promise<void> {
    const version = await this.getPublishedBinding(binding, pluginVersionId, capabilityKey);
    if (expectedWorkflowVersion !== undefined && version.content.metadata.version !== expectedWorkflowVersion) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布 Workflow 绑定的 DSL 版本与插件版本不一致', {
        code: 'PLUGIN_WORKFLOW_BINDING_VERSION_MISMATCH',
        pluginVersionId,
        capabilityKey,
        pluginVersion: expectedWorkflowVersion,
        workflowVersion: version.content.metadata.version,
        workflowVersionId: binding.workflowVersionId,
      });
    }
  }

  private async getPublishedBinding(
    binding: PluginWorkflowBindingRecord,
    pluginVersionId?: string,
    capabilityKey?: string,
  ): Promise<WorkflowTemplateVersion> {
    try {
      const version = await this.workflows.getVersion(binding.workflowVersionId);
      if (version.templateId !== binding.workflowTemplateId
        || version.status !== 'published'
        || version.contentHash !== binding.workflowContentSha256) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布 Workflow 绑定目标不完整或摘要不一致', {
          pluginVersionId,
          capabilityKey,
          workflowVersionId: binding.workflowVersionId,
        });
      }
      return version;
    } catch (error) {
      if (error instanceof AppError && error.errorCode === 'RESOURCE_VERSION_CONFLICT') throw error;
      throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布 Workflow 绑定目标不存在或不可执行', {
        pluginVersionId,
        capabilityKey,
        workflowVersionId: binding.workflowVersionId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private assertSharedBranchResource(record: UnifiedPluginVersionRecord): void {
    // 六个 Agent Plan 证书包各自发布 deploy/rollback Workflow；旧 DSL 包才要求共享
    // 带 rollback 分支的 deploy 资源。边界必须按固定 Canonical ID 判断，不能按
    // “没有 Runner 入口”猜测，否则新包会被误判为历史格式。
    if (certificateUpdatePluginIds.includes(record.pluginId as (typeof certificateUpdatePluginIds)[number])) return;
    if (record.manifest.resources.runtimeEntrypoint === 'runtime/index.js') return;
    const deployPath = record.manifest.resources.workflows?.['certificate.deploy'];
    const rollbackPath = record.manifest.resources.workflows?.['certificate.rollback'];
    if (deployPath && rollbackPath && deployPath !== rollbackPath) {
      throw new AppError('VALIDATION_FAILED', '旧 Workflow DSL 插件的 certificate.deploy 与 certificate.rollback 必须指向同一资源', {
        pluginVersionId: record.id,
        deployPath,
        rollbackPath,
      });
    }
  }

  private parseWorkflow(record: UnifiedPluginVersionRecord, capabilityKey: string, contentText: string): ParsedWorkflowResource {
    let raw: unknown;
    try {
      raw = JSON.parse(contentText);
    } catch (error) {
      throw new AppError('VALIDATION_FAILED', '插件 Workflow 资源不是有效 JSON', {
        pluginVersionId: record.id,
        capabilityKey,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (isPluginWorkflowResource(raw)) {
      throw new AppError('PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN', '包级 PluginWorkflow 已禁止；插件必须发布普通 DSL WorkflowVersion，Runner 只能由 plugin.action 步骤调用', {
        pluginVersionId: record.id,
        capabilityKey,
      });
    }
    const content = workflowTemplatesSchemaRegistry.validate(raw as WorkflowDslV1);
    if (content.metadata.version !== record.version) {
      throw new AppError('VALIDATION_FAILED', '插件内部 WorkflowVersion.metadata.version 必须与 PluginVersion.version 一致', {
        code: 'PLUGIN_WORKFLOW_VERSION_MISMATCH',
        pluginVersionId: record.id,
        pluginVersion: record.version,
        workflowVersion: content.metadata.version,
        capabilityKey,
      });
    }
    return { kind: 'dsl', content };
  }

  private assertCredentialAcquireContract(record: UnifiedPluginVersionRecord): void {
    const declared = record.manifest.capabilities.some((capability) => capability.key === 'credential.acquire');
    if (!declared) return;
    if (!record.manifest.credentialAcquire) {
      throw new AppError('VALIDATION_FAILED', 'credential.acquire 缺少 CredentialAcquireContract', { pluginVersionId: record.id });
    }
    const resourcePath = record.manifest.resources.workflows?.['credential.acquire'];
    if (!resourcePath) {
      throw new AppError('VALIDATION_FAILED', 'credential.acquire 缺少独立 Workflow DSL 资源', { pluginVersionId: record.id });
    }
    if (record.manifest.resources.workflows?.['certificate.deploy'] === resourcePath
      || record.manifest.resources.workflows?.['certificate.rollback'] === resourcePath) {
      throw new AppError('VALIDATION_FAILED', 'credential.acquire 不得复用部署或回滚 Workflow DSL 资源', { pluginVersionId: record.id });
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
    try {
      const draft = await this.workflows.createPluginInternalDraftVersion({
        templateId: previous.workflowTemplateId,
        content,
        changeSummary,
      });
      const published = await this.workflows.publishPluginVersion(draft.id);
      return { templateId: previous.workflowTemplateId, versionId: published.id, contentHash: published.contentHash };
    } catch (error) {
      if (!isDuplicateWorkflowContentError(error)) throw error;
      const existing = await this.findReusableWorkflowVersion(previous.workflowTemplateId, computeWorkflowContentHash(content));
      if (!existing) throw error;
      const published = existing.status === 'published' ? existing : await this.workflows.publishPluginVersion(existing.id);
      return { templateId: previous.workflowTemplateId, versionId: published.id, contentHash: published.contentHash };
    }
  }

  private async findReusableWorkflowVersion(templateId: string, contentHash: string): Promise<WorkflowTemplateVersion | undefined> {
    const versions = await this.workflows.listVersions(templateId);
    return [...versions]
      .filter((version) => version.templateId === templateId && version.contentHash === contentHash && version.status !== 'disabled')
      .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
  }
}

function ownerTypeOf(record: UnifiedPluginVersionRecord): 'SYSTEM' | 'TENANT' {
  return record.ownerType ?? (record.source === 'BUILTIN' ? 'SYSTEM' : 'TENANT');
}

function ownerIdOf(record: UnifiedPluginVersionRecord): string | undefined {
  return record.ownerId ?? (ownerTypeOf(record) === 'TENANT' ? record.tenantId : undefined);
}

function isDuplicateWorkflowContentError(error: unknown): boolean {
  return error instanceof AppError
    && error.errorCode === 'VALIDATION_FAILED'
    && typeof error.message === 'string'
    && error.message.includes('duplicate workflow version content');
}

type ParsedWorkflowResource =
  { kind: 'dsl'; content: WorkflowDslV1 };
