import type { RiskLevel } from '../../shared/security-types.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'consumed';
export type ApprovalDecision = 'approved' | 'rejected';

export interface ApprovalResourceRef {
  type: string;
  id: string;
}

export interface ApprovalRequestEntity {
  id: string;
  operationType: string;
  resourceRefs: ApprovalResourceRef[];
  riskLevel: RiskLevel;
  parameterHash: string;
  status: ApprovalStatus;
  requestedBy: string;
  approvedBy?: string;
  comment?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}
