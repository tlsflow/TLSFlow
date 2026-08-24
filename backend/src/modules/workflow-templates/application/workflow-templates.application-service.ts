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

  createTemplate(input: CreateWorkflowTemplateInput) {
    return this.domain.createTemplate(input);
  }

  createDraftVersion(input: UpdateWorkflowTemplateInput): WorkflowTemplateVersion {
    return this.domain.createDraftVersion(input);
  }

  publishVersion(versionId: string): WorkflowTemplateVersion {
    return this.domain.publishVersion(versionId);
  }

  disableTemplate(templateId: string): WorkflowTemplate {
    return this.domain.disableTemplate(templateId);
  }

  listTemplates(): WorkflowTemplate[] {
    return this.domain.listTemplates();
  }

  listVersions(templateId: string): WorkflowTemplateVersion[] {
    return this.domain.listVersions(templateId);
  }

  getVersion(versionId: string): WorkflowTemplateVersion {
    return this.domain.getVersion(versionId);
  }

  preview(input: WorkflowRuntimeInput) {
    return this.domain.preview(input);
  }

  testRun(input: WorkflowRuntimeInput) {
    return this.domain.testRun(input);
  }
}
