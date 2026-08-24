import { WorkflowTemplatesDomainService } from '../domain/workflow-templates.domain-service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { PluginWorkflowBindingsRepository, type PluginWorkflowBindingsRepositoryPort } from '../../plugins/repository/plugin-workflow-bindings.repository.js';
import { compileWorkflowCanvas, validateWorkflowCanvasInput } from '../domain/workflow-canvas.compiler.js';
import type {
  CreateWorkflowTemplateInput,
  RenameWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  UpdateWorkflowTemplateVersionNoteInput,
  WorkflowRuntimeInput,
  WorkflowStepRuntimeInput,
  WorkflowExecutorDispatcher,
  WorkflowProgressReporter,
  WorkflowListItem,
  WorkflowTemplate,
  WorkflowTemplateVersion,
} from '../dto/workflow-templates.dto.js';

export interface WorkflowTemplatesApplicationServiceOptions {
  stepDispatcher?: WorkflowExecutorDispatcher;
}

export class WorkflowTemplatesApplicationService {
  constructor(
    private readonly domain = new WorkflowTemplatesDomainService(),
    private readonly options: WorkflowTemplatesApplicationServiceOptions = {},
    private readonly workflowBindingsRepository: PluginWorkflowBindingsRepositoryPort = new PluginWorkflowBindingsRepository(),
  ) {}

  async createTemplate(input: CreateWorkflowTemplateInput) {
    return this.domain.createTemplate(input);
  }

  async createWorkflow(input: CreateWorkflowTemplateInput, tenantId?: string) {
    return this.domain.createTemplate(input, 'user', { ownerType: 'TENANT', tenantId, ownerId: tenantId });
  }

  async createPluginTemplate(input: CreateWorkflowTemplateInput, ownership: { ownerType?: 'SYSTEM' | 'TENANT'; ownerId?: string; tenantId?: string } = {}) {
    return this.domain.createTemplate(input, 'plugin_internal', {
      ownerType: ownership.ownerType ?? 'SYSTEM',
      ownerId: ownership.ownerId ?? 'SYSTEM',
      tenantId: ownership.tenantId,
    });
  }

  /** @deprecated 插件复制结果统一归类为 user，并在版本上记录 pluginSource。 */
  async createPluginDerivedWorkflow(input: CreateWorkflowTemplateInput) {
    return this.createWorkflow(input);
  }

  async renameTemplate(input: RenameWorkflowTemplateInput): Promise<WorkflowTemplate> {
    return this.domain.renameTemplate(input);
  }

  compileCanvas(input: unknown) {
    return compileWorkflowCanvas(input);
  }

  validateCanvas(input: unknown) {
    return validateWorkflowCanvasInput(input);
  }

  async createDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.createDraftVersion(input);
  }

  async createPluginInternalDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.createPluginInternalDraftVersion(input);
  }

  async promoteLegacyPluginTemplate(templateId: string): Promise<WorkflowTemplate> {
    return this.domain.promoteLegacyPluginTemplate(templateId);
  }

  async createDraftFromPluginCapability(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.createDraftFromPluginCapability(input);
  }

  async updateCurrentDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.updateCurrentDraftVersion(input);
  }

  async publishVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    return this.domain.publishVersion(versionId);
  }

  async publishPluginVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    return this.domain.publishVersion(versionId, true);
  }

  async updateVersionNote(input: UpdateWorkflowTemplateVersionNoteInput): Promise<WorkflowTemplateVersion> {
    return this.domain.updateVersionNote(input);
  }

  async disableTemplate(templateId: string): Promise<WorkflowTemplate> {
    return this.domain.disableTemplate(templateId);
  }

  async listTemplates(): Promise<WorkflowTemplate[]> {
    return this.domain.listTemplates();
  }

  /** 正式工作流目录同时展示插件内置和用户工作流。 */
  async listWorkflows(_tenantId: string): Promise<WorkflowListItem[]> {
    return this.mergePluginInternalWorkflows(await this.domain.listTemplates());
  }

  /** 仅供“从插件生成草稿”使用，目标必须是用户工作流。 */
  async listUserWorkflows(_tenantId: string): Promise<WorkflowTemplate[]> {
    return (await this.domain.listTemplates()).filter((template) => template.origin === 'user');
  }

  async listVersions(templateId: string): Promise<WorkflowTemplateVersion[]> {
    const templates = await this.domain.listTemplates();
    const selected = templates.find((template) => template.id === templateId);
    const templateIds = await this.resolveDisplayTemplateIds(templateId);
    const versions = await Promise.all(templateIds.map((id) => this.domain.listVersions(id)));
    const flattened = versions.flat();
    if (selected?.origin === 'plugin_internal') {
      return deduplicatePluginInternalVersions(flattened).sort(comparePluginInternalVersions);
    }
    return flattened.sort((left, right) => left.version - right.version || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  async getVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    return this.domain.getVersion(versionId);
  }

  async getRuntimePublishedVersion(templateId: string): Promise<WorkflowTemplateVersion | undefined> {
    return this.domain.getRuntimePublishedVersion(templateId);
  }

  async preview(input: WorkflowRuntimeInput, reporter?: WorkflowProgressReporter) {
    return this.domain.preview(input, reporter);
  }

  async testRun(input: WorkflowRuntimeInput) {
    return this.domain.testRun(input);
  }

  async execute(input: WorkflowRuntimeInput, reporter?: WorkflowProgressReporter) {
    if (!this.options.stepDispatcher) {
      throw new AppError('CAPABILITY_MISSING', '工作流正式执行器未注册');
    }
    return this.domain.runWithDispatcher(input, this.options.stepDispatcher, reporter);
  }

  async testStep(input: WorkflowStepRuntimeInput) {
    if (input.mode === 'real_test' && this.options.stepDispatcher) {
      return this.domain.testStepWithDispatcher(input, this.options.stepDispatcher);
    }
    return this.domain.testStep(input);
  }

  async runWithDispatcher(input: WorkflowRuntimeInput, dispatcher: WorkflowExecutorDispatcher, reporter?: WorkflowProgressReporter) {
    return this.domain.runWithDispatcher(input, dispatcher, reporter);
  }

  private async mergePluginInternalWorkflows(templates: WorkflowTemplate[]): Promise<WorkflowListItem[]> {
    const groups = await this.buildPluginInternalGroups(templates);
    const mergedIds = new Set<string>();
    const output: WorkflowListItem[] = [];
    for (const group of groups.values()) {
      const versions = (await Promise.all(group.map((template) => this.domain.listVersions(template.id)))).flat();
      const latestVersion = versions
        .filter((version) => version.status === 'published')
        .sort(comparePluginInternalVersions)[0] ?? versions.sort(comparePluginInternalVersions)[0];
      const canonical = group.find((template) => template.id === latestVersion?.templateId)
        ?? [...group].sort(compareWorkflowDisplayRecords)[0];
      if (!canonical || mergedIds.has(canonical.id)) continue;
      mergedIds.add(canonical.id);
      const capabilities = [...new Set(group.flatMap((template) => templateCapabilities(template)))].sort();
      const dslVersion = workflowDslVersion(latestVersion);
      const current = latestVersion ? {
        currentVersionId: latestVersion.id,
        currentVersion: latestVersion.version,
        currentVersionLabel: dslVersion ?? canonical.currentVersionLabel,
        status: latestVersion.status === 'disabled' ? 'disabled' as const : 'published' as const,
        updatedAt: latestVersion.createdAt,
      } : {};
      const item = { ...canonical, ...current };
      output.push(capabilities.length ? { ...item, capabilities } : item);
    }
    for (const template of templates) {
      if (template.origin === 'user') output.push(template);
    }
    return output;
  }

  private async resolveDisplayTemplateIds(templateId: string): Promise<string[]> {
    const templates = await this.domain.listTemplates();
    const groups = await this.buildPluginInternalGroups(templates);
    for (const group of groups.values()) {
      if (group.some((template) => template.id === templateId)) return group.map((template) => template.id);
    }
    return [templateId];
  }

  private async buildPluginInternalGroups(templates: WorkflowTemplate[]): Promise<Map<string, WorkflowTemplate[]>> {
    const bindings = await this.workflowBindingsRepository.listAll();
    const sourceKeyByTemplateId = new Map<string, string>();
    const capabilitiesByTemplateId = new Map<string, Set<string>>();
    for (const binding of bindings) {
      if (!binding.pluginId) continue;
      const key = `${binding.pluginId}:${binding.workflowResourcePath}`;
      if (!sourceKeyByTemplateId.has(binding.workflowTemplateId)) sourceKeyByTemplateId.set(binding.workflowTemplateId, key);
      const capabilities = capabilitiesByTemplateId.get(binding.workflowTemplateId) ?? new Set<string>();
      capabilities.add(binding.capabilityKey);
      capabilitiesByTemplateId.set(binding.workflowTemplateId, capabilities);
    }

    const groups = new Map<string, WorkflowTemplate[]>();
    for (const template of templates) {
      if (template.origin !== 'plugin_internal') continue;
      const key = sourceKeyByTemplateId.get(template.id) ?? `template:${template.id}`;
      const capabilities = capabilitiesByTemplateId.get(template.id);
      const item = capabilities?.size
        ? { ...template, capabilities: [...capabilities] }
        : template;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return groups;
  }
}

function templateCapabilities(template: WorkflowTemplate): string[] {
  const capabilities = (template as WorkflowListItem).capabilities;
  return Array.isArray(capabilities) ? capabilities : [];
}

function compareWorkflowDisplayRecords(left: WorkflowTemplate, right: WorkflowTemplate): number {
  return (right.currentVersion ?? 0) - (left.currentVersion ?? 0)
    || right.updatedAt.localeCompare(left.updatedAt)
    || right.id.localeCompare(left.id);
}

function deduplicatePluginInternalVersions(versions: WorkflowTemplateVersion[]): WorkflowTemplateVersion[] {
  const unique = new Map<string, WorkflowTemplateVersion>();
  for (const version of versions) {
    const dslVersion = workflowDslVersion(version);
    const key = dslVersion ? `dsl:${dslVersion}` : `id:${version.id}`;
    const existing = unique.get(key);
    if (!existing || comparePluginInternalVersions(version, existing) < 0) unique.set(key, version);
  }
  return [...unique.values()];
}

function comparePluginInternalVersions(left: WorkflowTemplateVersion, right: WorkflowTemplateVersion): number {
  const leftDslVersion = workflowDslVersion(left);
  const rightDslVersion = workflowDslVersion(right);
  if (leftDslVersion && rightDslVersion) {
    const semanticOrder = compareSemanticVersions(rightDslVersion, leftDslVersion);
    if (semanticOrder !== 0) return semanticOrder;
  } else if (leftDslVersion) {
    return -1;
  } else if (rightDslVersion) {
    return 1;
  }
  if (left.status !== right.status) return left.status === 'published' ? -1 : right.status === 'published' ? 1 : 0;
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function workflowDslVersion(version: WorkflowTemplateVersion | undefined): string | undefined {
  const value = version?.content.metadata.version?.trim();
  return value || undefined;
}

function compareSemanticVersions(left: string, right: string): number {
  const [leftCoreText, leftPreRelease = ''] = left.split('+', 1)[0]!.split('-', 2);
  const [rightCoreText, rightPreRelease = ''] = right.split('+', 1)[0]!.split('-', 2);
  const leftCore = leftCoreText!.split('.').map(Number);
  const rightCore = rightCoreText!.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((leftCore[index] ?? 0) !== (rightCore[index] ?? 0)) return (leftCore[index] ?? 0) - (rightCore[index] ?? 0);
  }
  if (!leftPreRelease && !rightPreRelease) return 0;
  if (!leftPreRelease) return 1;
  if (!rightPreRelease) return -1;
  return leftPreRelease.localeCompare(rightPreRelease);
}
