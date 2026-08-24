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
  connectionBindings: Record<string, unknown>;
  variableBindings: Record<string, unknown>;
  credentialBindings: Record<string, { credentialId: string }>;
  certificateArtifactBindings: Record<string, unknown>;
  status: WorkflowExecutionBindingStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateWorkflowExecutionBindingInput = Omit<WorkflowExecutionBinding, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;
export type UpdateWorkflowExecutionBindingInput = Partial<Omit<CreateWorkflowExecutionBindingInput, 'tenantId'>> & { expectedVersion: number; status?: WorkflowExecutionBindingStatus };
