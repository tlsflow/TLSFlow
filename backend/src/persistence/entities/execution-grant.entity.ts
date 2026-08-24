export type ExecutionGrantStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface ExecutionGrantEntity {
  id: string;
  tenantId?: string;
  planId?: string;
  runId: string;
  stepId: string;
  targetId?: string;
  workflowVersionId?: string;
  approvalId?: string;
  executorType: string;
  allowedSecretRefs: string[];
  allowedArtifactRefs?: string[];
  allowedActions: string[];
  expiresAt: string;
  status: ExecutionGrantStatus;
  createdAt: string;
  updatedAt: string;
}
