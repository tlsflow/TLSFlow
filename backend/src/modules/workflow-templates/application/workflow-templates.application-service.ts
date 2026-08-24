import { WorkflowTemplatesDomainService } from '../domain/workflow-templates.domain-service.js';
import type {
  CreateWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  WorkflowRuntimeInput,
  WorkflowTemplate,
  WorkflowTemplateVersion,
} from '../dto/workflow-templates.dto.js';

export class WorkflowTemplatesApplicationService {
  constructor(private readonly domain = new WorkflowTemplatesDomainService()) {}

  async createTemplate(input: CreateWorkflowTemplateInput) {
    return this.domain.createTemplate(input);
  }

  async createDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    return this.domain.createDraftVersion(input);
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
}
