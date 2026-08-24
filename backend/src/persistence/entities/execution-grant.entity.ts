export type ExecutionGrantStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface ExecutionGrantEntity {
  id: string;
  runId: string;
  stepId: string;
  executorType: string;
  allowedSecretRefs: string[];
  allowedArtifactRefs?: string[];
  allowedActions: string[];
  expiresAt: string;
  status: ExecutionGrantStatus;
  createdAt: string;
  updatedAt: string;
}
