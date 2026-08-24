import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { AsyncRepositoryPort } from '../../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { WorkflowTemplate } from '../../workflow-templates/dto/workflow-templates.dto.js';
import { computeWorkflowContentHash } from '../../workflow-templates/domain/workflow-templates.domain-service.js';
import {
  isPluginWorkflowResource,
  isPluginWorkflowRunnerResource,
  type PluginWorkflowResourceV1,
} from '../schema/plugin-workflow.schema.js';

export interface PluginWorkflowVersionRecord {
  id: string;
  templateId: string;
  version: number;
  dslVersion: 'v1';
  content: PluginWorkflowResourceV1;
  executionMode: 'PLUGIN_RUNNER';
  contentHash: string;
  status: 'draft' | 'published' | 'disabled';
  changeSummary?: string;
  createdAt: string;
}

export interface PluginWorkflowVersionStorePort {
  createTemplate(
    content: PluginWorkflowResourceV1,
    ownership: { ownerType: 'SYSTEM' | 'TENANT'; ownerId?: string; tenantId?: string },
    changeSummary?: string,
  ): Promise<{ template: WorkflowTemplate; version: PluginWorkflowVersionRecord }>;
  createDraftVersion(input: { templateId: string; content: PluginWorkflowResourceV1; changeSummary?: string }): Promise<PluginWorkflowVersionRecord>;
  publishVersion(versionId: string): Promise<PluginWorkflowVersionRecord>;
  getVersion(versionId: string): Promise<PluginWorkflowVersionRecord>;
  findReusableVersion(templateId: string, contentHash: string): Promise<PluginWorkflowVersionRecord | undefined>;
}

/**
 * PluginWorkflow 的持久化路径。
 *
 * 该存储与旧 Curl/SSH DSL 共用 WorkflowVersion 文档空间，但只接受
 * PluginWorkflow 内容，不把插件步骤投影成宿主步骤，也不参与旧执行器。
 */
export class PluginWorkflowVersionStore implements PluginWorkflowVersionStorePort {
  private static readonly defaultDb = new PgliteDatabase();

  private readonly templates: AsyncRepositoryPort<WorkflowTemplate>;
  private readonly versions: AsyncRepositoryPort<PluginWorkflowVersionRecord>;
  private readonly templateCache = new Map<string, WorkflowTemplate>();
  private readonly versionCache = new Map<string, PluginWorkflowVersionRecord[]>();
  private readonly ready: Promise<void>;

  constructor(
    db: DatabasePort = PluginWorkflowVersionStore.defaultDb,
    templatesRepository?: AsyncRepositoryPort<WorkflowTemplate>,
    versionsRepository?: AsyncRepositoryPort<PluginWorkflowVersionRecord>,
  ) {
    this.templates = templatesRepository ?? new PgDocumentRepository<WorkflowTemplate>(db, 'workflow.templates');
    this.versions = versionsRepository ?? new PgDocumentRepository<PluginWorkflowVersionRecord>(db, 'workflow.template_versions');
    this.ready = this.rehydrate();
  }

  async createTemplate(
    content: PluginWorkflowResourceV1,
    ownership: { ownerType: 'SYSTEM' | 'TENANT'; ownerId?: string; tenantId?: string },
    changeSummary?: string,
  ): Promise<{ template: WorkflowTemplate; version: PluginWorkflowVersionRecord }> {
    await this.ready;
    assertPluginWorkflowContent(content);
    const now = new Date().toISOString();
    const template: WorkflowTemplate = {
      id: `wftpl_${randomUUID()}`,
      name: content.metadata.name,
      origin: 'plugin_internal',
      ownerType: ownership.ownerType,
      ...(ownership.ownerId ? { ownerId: ownership.ownerId } : {}),
      ...(ownership.tenantId ? { tenantId: ownership.tenantId } : {}),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    const version = createVersion(template.id, 1, content, 'draft', changeSummary);
    template.currentVersionId = version.id;
    this.templateCache.set(template.id, template);
    this.versionCache.set(template.id, [version]);
    await this.templates.upsert(template);
    await this.versions.upsert(version);
    return { template: structuredClone(template), version: structuredClone(version) };
  }

  async createDraftVersion(input: { templateId: string; content: PluginWorkflowResourceV1; changeSummary?: string }): Promise<PluginWorkflowVersionRecord> {
    await this.ready;
    assertPluginWorkflowContent(input.content);
    const template = await this.getTemplate(input.templateId);
    if (template.origin !== 'plugin_internal') {
      throw new AppError('VALIDATION_FAILED', 'PluginWorkflow 只能追加到插件内部 WorkflowTemplate', { templateId: input.templateId });
    }
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'WorkflowTemplate 已禁用', { templateId: input.templateId });
    const list = await this.listAllTemplateVersions(template.id);
    if (list.some((version) => !isPluginWorkflowContent(version.content))) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '不能把 PluginWorkflow 写入旧 Workflow DSL 模板', { templateId: template.id });
    }
    const contentHash = computeWorkflowContentHash(input.content);
    if (list.some((version) => version.contentHash === contentHash)) {
      throw new AppError('VALIDATION_FAILED', 'duplicate workflow version content');
    }
    // 插件版本事实由 Manifest 的 pluginId@version 和包摘要承担。
    // Workflow metadata.version 只在 Schema 边界校验格式，不重复建立版本门禁。
    const version = createVersion(
      template.id,
      list.reduce((max, item) => Math.max(max, item.version), 0) + 1,
      input.content,
      'draft',
      input.changeSummary,
    );
    this.versionCache.set(template.id, [...list, version]);
    template.currentVersionId = version.id;
    template.status = 'draft';
    template.updatedAt = new Date().toISOString();
    this.templateCache.set(template.id, template);
    await this.templates.upsert(template);
    await this.versions.upsert(version);
    return structuredClone(version);
  }

  async publishVersion(versionId: string): Promise<PluginWorkflowVersionRecord> {
    await this.ready;
    const { template, version } = await this.findVersion(versionId);
    if (template.origin !== 'plugin_internal') {
      throw new AppError('VALIDATION_FAILED', '只有插件内部 WorkflowVersion 可以发布', { versionId });
    }
    if (template.status === 'disabled' || version.status === 'disabled') {
      throw new AppError('VALIDATION_FAILED', 'WorkflowVersion 已禁用', { versionId });
    }
    version.status = 'published';
    template.currentVersionId = version.id;
    template.status = 'published';
    template.updatedAt = new Date().toISOString();
    this.templateCache.set(template.id, template);
    await this.templates.upsert(template);
    await this.versions.upsert(version);
    return structuredClone(version);
  }

  async getVersion(versionId: string): Promise<PluginWorkflowVersionRecord> {
    await this.ready;
    return structuredClone((await this.findVersion(versionId)).version);
  }

  async findReusableVersion(templateId: string, contentHash: string): Promise<PluginWorkflowVersionRecord | undefined> {
    await this.ready;
    await this.getTemplate(templateId);
    const versions = this.versionCache.get(templateId) ?? [];
    const selected = versions
      .filter((version) => version.contentHash === contentHash && version.status !== 'disabled')
      .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
    return selected ? structuredClone(selected) : undefined;
  }

  private async getTemplate(templateId: string): Promise<WorkflowTemplate> {
    const cached = this.templateCache.get(templateId);
    if (cached) return cached;
    const persisted = await this.templates.get(templateId);
    if (!persisted || persisted.origin !== 'plugin_internal' && persisted.origin !== 'user') {
      throw new AppError('RESOURCE_NOT_FOUND', 'WorkflowTemplate 不存在', { templateId });
    }
    this.templateCache.set(templateId, persisted);
    return persisted;
  }

  private async listAllTemplateVersions(templateId: string): Promise<PluginWorkflowVersionRecord[]> {
    const persisted = await this.versions.list((version) => version.templateId === templateId);
    for (const version of persisted) {
      if (isPluginWorkflowContent(version.content)) this.cacheVersion(version);
    }
    return persisted;
  }

  private async findVersion(versionId: string): Promise<{ template: WorkflowTemplate; version: PluginWorkflowVersionRecord }> {
    for (const [templateId, versions] of this.versionCache.entries()) {
      const version = versions.find((item) => item.id === versionId);
      if (version) return { template: await this.getTemplate(templateId), version };
    }
    const persisted = await this.versions.get(versionId);
    if (!persisted || !isPluginWorkflowContent(persisted.content)) {
      throw new AppError('RESOURCE_NOT_FOUND', 'PluginWorkflow WorkflowVersion 不存在', { versionId });
    }
    const template = await this.getTemplate(persisted.templateId);
    this.cacheVersion(persisted);
    return { template, version: persisted };
  }

  private cacheVersion(version: PluginWorkflowVersionRecord): void {
    const list = this.versionCache.get(version.templateId) ?? [];
    this.versionCache.set(
      version.templateId,
      [...list.filter((item) => item.id !== version.id), version]
        .sort((left, right) => left.version - right.version || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    );
  }

  private async rehydrate(): Promise<void> {
    const templates = await this.templates.list();
    const versions = await this.versions.list();
    this.templateCache.clear();
    this.versionCache.clear();
    for (const template of templates) {
      if (template.origin === 'plugin_internal' || template.origin === 'user') this.templateCache.set(template.id, template);
    }
    for (const version of versions) {
      if (!isPluginWorkflowContent(version.content)) continue;
      this.cacheVersion(version);
    }
  }
}

function createVersion(
  templateId: string,
  version: number,
  content: PluginWorkflowResourceV1,
  status: PluginWorkflowVersionRecord['status'],
  changeSummary?: string,
): PluginWorkflowVersionRecord {
  return {
    id: `wftplv_${randomUUID()}`,
    templateId,
    version,
    dslVersion: 'v1',
    content: structuredClone(content),
    executionMode: 'PLUGIN_RUNNER',
    contentHash: computeWorkflowContentHash(content),
    status,
    ...(changeSummary ? { changeSummary } : {}),
    createdAt: new Date().toISOString(),
  };
}

function assertPluginWorkflowContent(content: PluginWorkflowResourceV1): void {
  if (!isPluginWorkflowContent(content)) {
    throw new AppError('VALIDATION_FAILED', 'WorkflowVersion 内容不是 PluginWorkflow');
  }
}

function isPluginWorkflowContent(content: unknown): content is PluginWorkflowResourceV1 {
  return isPluginWorkflowResource(content) || isPluginWorkflowRunnerResource(content);
}
