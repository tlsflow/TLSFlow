export type WorkflowExecutionBindingStatus = 'ACTIVE' | 'DISABLED';
export type WorkflowExecutionRunner = 'CONTROL_PLANE' | 'GATEWAY';
export type WorkflowExecutionVersionSelection = 'PINNED' | 'LATEST_PUBLISHED';

export interface WorkflowExecutionBinding {
  id: string;
  tenantId: string;
  workflowTemplateId: string;
  workflowVersionSelection: WorkflowExecutionVersionSelection;
  workflowVersionId?: string;
  runner: WorkflowExecutionRunner;
  gatewayId?: string;
  inputBindings: InputBindingsV1;
  status: WorkflowExecutionBindingStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateWorkflowExecutionBindingInput = Omit<WorkflowExecutionBinding, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;
export type UpdateWorkflowExecutionBindingInput = Partial<Omit<CreateWorkflowExecutionBindingInput, 'tenantId'>> & { expectedVersion: number; status?: WorkflowExecutionBindingStatus };
import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
