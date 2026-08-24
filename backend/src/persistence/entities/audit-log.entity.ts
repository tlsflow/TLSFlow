import type { ActorType, AuditResult, RiskLevel } from '../../shared/security-types.js';

export interface AuditLogEntity {
  id: string;
  tenantId?: string;
  eventType: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  riskLevel: RiskLevel;
  requestId?: string;
  sourceIp?: string;
  detail?: unknown;
  createdAt: string;
}
