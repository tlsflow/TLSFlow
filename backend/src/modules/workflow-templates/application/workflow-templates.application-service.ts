import { WorkflowTemplatesDomainService } from '../domain/workflow-templates.domain-service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { PgPluginsRepository, type PluginsRepository } from '../../plugins/repository/plugins.repository.js';
import { compileWorkflowCanvas, validateWorkflowCanvasInput } from '../domain/workflow-canvas.compiler.js';
import type {
  ApplyWorkflowTemplateFromFileInput,
  CreateWorkflowTemplateInput,
  CreateWorkflowTemplateFromFileInput,
  RenameWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  UpdateWorkflowTemplateVersionNoteInput,
  WorkflowRuntimeInput,
  WorkflowStepRuntimeInput,
  WorkflowExecutorDispatcher,
  WorkflowProgressReporter,
  WorkflowFileTemplate,
  WorkflowTemplate,
  WorkflowTemplateVersion,
} from '../dto/workflow-templates.dto.js';

export interface WorkflowTemplatesApplicationServiceOptions {
  stepDispatcher?: WorkflowExecutorDispatcher;
}

export interface WorkflowFileTemplateListOptions {
  tenantId?: string;
  enabledOnly?: boolean;
}

export class WorkflowTemplatesApplicationService {
  constructor(
    private readonly domain = new WorkflowTemplatesDomainService(),
    private readonly options: WorkflowTemplatesApplicationServiceOptions = {},
    private readonly pluginsRepository: PluginsRepository = new PgPluginsRepository(),
  ) {}

  async createTemplate(input: CreateWorkflowTemplateInput) {
    return this.domain.createTemplate(input);
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

  async listFileTemplates(options: WorkflowFileTemplateListOptions = {}): Promise<WorkflowFileTemplate[]> {
    const files = await this.domain.listFileTemplates();
    if (!options.enabledOnly) return files;
    if (!options.tenantId) return [];
    const activations = await this.pluginsRepository.listCatalogActivations(options.tenantId);
    const enabled = new Set(activations
      .filter((record) => record.catalogType === 'WORKFLOW_TEMPLATE' && record.status === 'enabled')
      .map((record) => record.pluginId));
    return files.filter((file) => file.valid && enabled.has(file.id));
  }

  async createTemplateFromFile(input: CreateWorkflowTemplateFromFileInput, tenantId?: string) {
    if (tenantId) await this.assertFileTemplateEnabled(tenantId, input.fileTemplateId);
    return await this.domain.createTemplateFromFile(input);
  }

  async createDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.createDraftVersion(input);
  }

  async updateCurrentDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.updateCurrentDraftVersion(input);
  }

  async applyFileTemplateToTemplate(input: ApplyWorkflowTemplateFromFileInput, tenantId?: string): Promise<WorkflowTemplateVersion> {
    if (tenantId) await this.assertFileTemplateEnabled(tenantId, input.fileTemplateId);
    return await this.domain.applyFileTemplateToTemplate(input);
  }

  private async assertFileTemplateEnabled(tenantId: string, fileTemplateId: string): Promise<void> {
    const activation = await this.pluginsRepository.findCatalogActivation(tenantId, 'WORKFLOW_TEMPLATE', fileTemplateId);
    if (activation?.status !== 'enabled') throw new AppError('PLUGIN_PERMISSION_DENIED', 'DSL 模板插件未手动启用', { fileTemplateId });
  }

  async publishVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    return this.domain.publishVersion(versionId);
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

  async listVersions(templateId: string): Promise<WorkflowTemplateVersion[]> {
    return this.domain.listVersions(templateId);
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
}
