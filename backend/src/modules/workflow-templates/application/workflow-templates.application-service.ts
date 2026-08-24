import { WorkflowTemplatesDomainService } from '../domain/workflow-templates.domain-service.js';
import type {
  ApplyWorkflowTemplateFromFileInput,
  CreateWorkflowTemplateInput,
  CreateWorkflowTemplateFromFileInput,
  UpdateWorkflowTemplateInput,
  WorkflowRuntimeInput,
  WorkflowStepRuntimeInput,
  WorkflowExecutorDispatcher,
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

  async listFileTemplates(): Promise<WorkflowFileTemplate[]> {
    return await this.domain.listFileTemplates();
  }

  async createTemplateFromFile(input: CreateWorkflowTemplateFromFileInput) {
    return await this.domain.createTemplateFromFile(input);
  }

  async createDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.createDraftVersion(input);
  }

  async applyFileTemplateToTemplate(input: ApplyWorkflowTemplateFromFileInput): Promise<WorkflowTemplateVersion> {
    return await this.domain.applyFileTemplateToTemplate(input);
  }

  async publishVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    return this.domain.publishVersion(versionId);
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

  async preview(input: WorkflowRuntimeInput) {
    return this.domain.preview(input);
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

  async runWithDispatcher(input: WorkflowRuntimeInput, dispatcher: WorkflowExecutorDispatcher) {
    return this.domain.runWithDispatcher(input, dispatcher);
  }
}
