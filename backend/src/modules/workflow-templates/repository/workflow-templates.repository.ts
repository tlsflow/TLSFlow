import type { WorkflowTemplate, WorkflowTemplateVersion } from '../dto/workflow-templates.dto.js';

export interface WorkflowTemplatesRepository {
  readonly moduleName: 'workflow-templates';
  listTemplates(): WorkflowTemplate[];
  listVersions(templateId: string): WorkflowTemplateVersion[];
}

export class InMemoryWorkflowTemplatesRepository implements WorkflowTemplatesRepository {
  readonly moduleName = 'workflow-templates' as const;

  constructor(
    private readonly templates: WorkflowTemplate[] = [],
    private readonly versions: WorkflowTemplateVersion[] = [],
  ) {}

  listTemplates(): WorkflowTemplate[] {
    return this.templates.map((item) => ({ ...item }));
  }

  listVersions(templateId: string): WorkflowTemplateVersion[] {
    return this.versions.filter((item) => item.templateId === templateId).map((item) => JSON.parse(JSON.stringify(item)) as WorkflowTemplateVersion);
  }
}
