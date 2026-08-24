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
  async listWorkflows(_tenantId: string): Promise<WorkflowTemplate[]> {
    return this.mergePluginInternalWorkflows(await this.domain.listTemplates());
  }

  /** 仅供“从插件生成草稿”使用，目标必须是用户工作流。 */
  async listUserWorkflows(_tenantId: string): Promise<WorkflowTemplate[]> {
    return (await this.domain.listTemplates()).filter((template) => template.origin === 'user');
  }

  async listVersions(templateId: string): Promise<WorkflowTemplateVersion[]> {
    const templateIds = await this.resolveDisplayTemplateIds(templateId);
    const versions = await Promise.all(templateIds.map((id) => this.domain.listVersions(id)));
    return versions
      .flat()
      .sort((left, right) => left.version - right.version || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
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

  private async mergePluginInternalWorkflows(templates: WorkflowTemplate[]): Promise<WorkflowTemplate[]> {
    const groups = await this.buildPluginInternalGroups(templates);
    const mergedIds = new Set<string>();
    const output: WorkflowTemplate[] = [];
    for (const group of groups.values()) {
      const canonical = [...group].sort(compareWorkflowDisplayRecords)[0];
      if (!canonical || mergedIds.has(canonical.id)) continue;
      mergedIds.add(canonical.id);
      output.push(canonical);
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
    for (const binding of bindings) {
      if (!binding.pluginId) continue;
      const key = `${binding.pluginId}:${binding.workflowResourcePath}`;
      if (!sourceKeyByTemplateId.has(binding.workflowTemplateId)) sourceKeyByTemplateId.set(binding.workflowTemplateId, key);
    }

    const groups = new Map<string, WorkflowTemplate[]>();
    for (const template of templates) {
      if (template.origin !== 'plugin_internal') continue;
      const key = sourceKeyByTemplateId.get(template.id) ?? `template:${template.id}`;
      groups.set(key, [...(groups.get(key) ?? []), template]);
    }
    return groups;
  }
}

function compareWorkflowDisplayRecords(left: WorkflowTemplate, right: WorkflowTemplate): number {
  return (right.currentVersion ?? 0) - (left.currentVersion ?? 0)
    || right.updatedAt.localeCompare(left.updatedAt)
    || right.id.localeCompare(left.id);
}
