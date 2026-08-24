import { createModuleMetadata } from '../../placeholder-module.js';

export class WorkflowTemplatesApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('workflow-templates', '/api/v1/workflow-templates', '025');
  }
}
