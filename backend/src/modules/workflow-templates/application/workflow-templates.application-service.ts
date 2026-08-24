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

  async listWorkflows(_tenantId: string): Promise<WorkflowTemplate[]> {
    return (await this.domain.listTemplates()).filter((template) => template.origin === 'user');
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
