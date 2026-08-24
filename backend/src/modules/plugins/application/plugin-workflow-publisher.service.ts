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
  pluginWorkflowSchemaRegistry,
  type PluginWorkflowResourceV1,
} from '../schema/plugin-workflow.schema.js';
import {
  PluginWorkflowVersionStore,
  type PluginWorkflowVersionStorePort,
} from './plugin-workflow-version-store.js';
import {
  resolveManifestWorkflowDeclarations,
  type PluginWorkflowDeclaration,
  type PluginWorkflowDeclarationResolver,
} from './plugin-workflow-declaration-resolver.js';

export class PluginWorkflowPublisherService {
  constructor(
    private readonly workflows: WorkflowTemplatesApplicationService,
    private readonly repository: PluginWorkflowBindingsRepositoryPort = new PluginWorkflowBindingsRepository(),
    private readonly pluginWorkflows: PluginWorkflowVersionStorePort = new PluginWorkflowVersionStore(),
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
        this.assertSameResource(record.id, capabilityKey, workflowKey, resourcePath, contentSha256, existing);
        await this.assertPublishedBinding(existing, parsed.kind);
        output.push(existing);
        continue;
      }
      const shared = capabilityKey === 'credential.acquire'
        ? undefined
        : await this.repository.findByResource(record.id, resourcePath);
      if (shared) {
        this.assertSameResource(record.id, capabilityKey, workflowKey, resourcePath, contentSha256, shared);
        await this.assertPublishedBinding(shared, parsed.kind);
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
        ? await this.reusePublishedBinding(previous, parsed.kind, record.id, capabilityKey)
        : parsed.kind === 'plugin'
          ? await this.publishPluginWorkflowVersion(record, parsed.content, previous)
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
    kind: ParsedWorkflowResource['kind'],
    pluginVersionId: string,
    capabilityKey: string,
  ): Promise<{ templateId: string; versionId: string; contentHash: string }> {
    await this.assertPublishedBinding(binding, kind, pluginVersionId, capabilityKey);
    return {
      templateId: binding.workflowTemplateId,
      versionId: binding.workflowVersionId,
      contentHash: binding.workflowContentSha256,
    };
  }

  private async assertPublishedBinding(
    binding: PluginWorkflowBindingRecord,
    kind: ParsedWorkflowResource['kind'],
    pluginVersionId?: string,
    capabilityKey?: string,
  ): Promise<void> {
    try {
      const version = kind === 'plugin'
        ? await this.pluginWorkflows.getVersion(binding.workflowVersionId)
        : await this.workflows.getVersion(binding.workflowVersionId);
      if (version.templateId !== binding.workflowTemplateId
        || version.status !== 'published'
        || version.contentHash !== binding.workflowContentSha256
        || (kind === 'plugin' && version.executionMode !== 'PLUGIN_RUNNER')) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '已发布 Workflow 绑定目标不完整或摘要不一致', {
          pluginVersionId,
          capabilityKey,
          workflowVersionId: binding.workflowVersionId,
        });
      }
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
      const capability = record.manifest.capabilities.find((item) => item.key === capabilityKey);
      if (!capability) throw new AppError('VALIDATION_FAILED', 'PluginWorkflow 引用了未声明能力', { pluginVersionId: record.id, capabilityKey });
      return { kind: 'plugin', content: pluginWorkflowSchemaRegistry.validate(raw, { pluginId: record.pluginId, capability }) };
    }
    if (record.manifest.resources.runtimeEntrypoint === 'runtime/index.js') {
      const capability = record.manifest.capabilities.find((item) => item.key === capabilityKey);
      if (!capability) throw new AppError('VALIDATION_FAILED', 'Runner Workflow 引用了未声明能力', { pluginVersionId: record.id, capabilityKey });
      return {
        kind: 'plugin',
        content: pluginWorkflowSchemaRegistry.validateRunnerResource(raw, {
          pluginId: record.pluginId,
          capability,
        }),
      };
    }
    return { kind: 'dsl', content: workflowTemplatesSchemaRegistry.validate(raw as WorkflowDslV1) };
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

  private async publishPluginWorkflowVersion(
    record: UnifiedPluginVersionRecord,
    content: PluginWorkflowResourceV1,
    previous: PluginWorkflowBindingRecord | undefined,
  ): Promise<{ templateId: string; versionId: string; contentHash: string }> {
    const changeSummary = `由插件 ${record.pluginId}@${record.version} 发布 PluginWorkflow`;
    if (!previous) {
      const created = await this.pluginWorkflows.createTemplate(content, {
        ownerType: ownerTypeOf(record),
        ...(ownerIdOf(record) ? { ownerId: ownerIdOf(record) } : {}),
        tenantId: record.tenantId,
      }, changeSummary);
      const published = await this.pluginWorkflows.publishVersion(created.version.id);
      return { templateId: created.template.id, versionId: published.id, contentHash: published.contentHash };
    }
    try {
      const draft = await this.pluginWorkflows.createDraftVersion({
        templateId: previous.workflowTemplateId,
        content,
        changeSummary,
      });
      const published = await this.pluginWorkflows.publishVersion(draft.id);
      return { templateId: previous.workflowTemplateId, versionId: published.id, contentHash: published.contentHash };
    } catch (error) {
      if (!isDuplicateWorkflowContentError(error)) throw error;
      const existing = await this.pluginWorkflows.findReusableVersion(previous.workflowTemplateId, computeWorkflowContentHash(content));
      if (!existing) throw error;
      const published = existing.status === 'published' ? existing : await this.pluginWorkflows.publishVersion(existing.id);
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
  | { kind: 'dsl'; content: WorkflowDslV1 }
  | { kind: 'plugin'; content: PluginWorkflowResourceV1 };
