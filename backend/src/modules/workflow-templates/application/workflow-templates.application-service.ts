import { WorkflowTemplatesDomainService } from '../domain/workflow-templates.domain-service.js';
import { compileWorkflowCanvas, validateWorkflowCanvasInput } from '../domain/workflow-canvas.compiler.js';
import type {
  ApplyWorkflowTemplateFromFileInput,
  CreateWorkflowTemplateInput,
  CreateWorkflowTemplateFromFileInput,
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

export class WorkflowTemplatesApplicationService {
  constructor(
    private readonly domain = new WorkflowTemplatesDomainService(),
    private readonly options: WorkflowTemplatesApplicationServiceOptions = {},
  ) {}

  async createTemplate(input: CreateWorkflowTemplateInput) {
    return this.domain.createTemplate(input);
  }

  compileCanvas(input: unknown) {
    return compileWorkflowCanvas(input);
  }

  validateCanvas(input: unknown) {
    return validateWorkflowCanvasInput(input);
  }

  async listFileTemplates(): Promise<WorkflowFileTemplate[]> {
    return await this.domain.listFileTemplates();
  }

  async createTemplateFromFile(input: CreateWorkflowTemplateFromFileInput) {
    return await this.domain.createTemplateFromFile(input);
  }

  async createDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.createDraftVersion(input);
  }

  async updateCurrentDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.updateCurrentDraftVersion(input);
  }

  async applyFileTemplateToTemplate(input: ApplyWorkflowTemplateFromFileInput): Promise<WorkflowTemplateVersion> {
    return await this.domain.applyFileTemplateToTemplate(input);
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
