import type { WriteAuditInput } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { RequestContext, ResourceDescriptor, RiskLevel, SecuritySubject } from '../../shared/security-types.js';

export const caOperationsPermissionActions = [
  'ca.operations.read',
  'ca.operations.sync',
  'ca.operations.sync.full',
  'ca.request.approve',
  'ca.request.retry',
  'ca.certificate.revoke',
  'ca.crl.publish',
  'ca.template.mapping.read',
  'ca.template.mapping.manage',
  'ca.provider.manage',
  'ca.authority.manage',
] as const;

export type CaOperationsPermissionAction = typeof caOperationsPermissionActions[number];

export interface CaOperationsResourceScope {
  tenantId: string;
  trustDomainId?: string;
  caId?: string;
  providerId?: string;
  resourceType: string;
  resourceId?: string;
}

export interface CaOperationsAuthorizationPort {
  assertCan(subject: SecuritySubject, action: string, resource: ResourceDescriptor, context?: RequestContext): Promise<void>;
}

export interface CaOperationsAuditPort {
  write(input: WriteAuditInput): Promise<unknown>;
}

export function caOperationsResource(scope: CaOperationsResourceScope): ResourceDescriptor {
  return {
    type: scope.resourceType,
    id: scope.resourceId,
    scope: {
      tenantId: scope.tenantId,
      trustDomainId: scope.trustDomainId,
      caId: scope.caId,
      providerId: scope.providerId,
      resourceType: scope.resourceType,
      resourceId: scope.resourceId,
    },
  };
}

export async function assertCaOperationsPermission(
  authorization: CaOperationsAuthorizationPort,
  subject: SecuritySubject,
  action: CaOperationsPermissionAction,
  scope: CaOperationsResourceScope,
  context?: RequestContext,
): Promise<void> {
  await authorization.assertCan(subject, action, caOperationsResource(scope), context);
}

export async function writeCaOperationsAudit(
  audit: CaOperationsAuditPort,
  input: {
    eventType: CaOperationsAuditEventType;
    actor: SecuritySubject;
    action: CaOperationsPermissionAction;
    scope: CaOperationsResourceScope;
    result: 'success' | 'failure';
    riskLevel: RiskLevel;
    detail?: Record<string, unknown>;
    context?: RequestContext;
  },
): Promise<void> {
  await audit.write({
    eventType: input.eventType,
    actorType: auditActorType(input.actor),
    actorId: input.actor.id,
    action: input.action,
    resourceType: input.scope.resourceType,
    resourceId: input.scope.resourceId,
    result: input.result,
    riskLevel: input.riskLevel,
    detail: {
      tenantId: input.scope.tenantId,
      trustDomainId: input.scope.trustDomainId,
      caId: input.scope.caId,
      providerId: input.scope.providerId,
      ...input.detail,
    },
    context: input.context,
    failClosed: input.riskLevel === 'high' || input.riskLevel === 'critical',
  });
}

export type CaOperationsAuditEventType =
  | typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_RECORD_READ
  | typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_EXPORTED
  | typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_STARTED
  | typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_COMPLETED
  | typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_FAILED
  | typeof AUDIT_EVENT_TYPES.CA_TEMPLATE_MAPPING_CREATED
  | typeof AUDIT_EVENT_TYPES.CA_TEMPLATE_MAPPING_UPDATED
  | typeof AUDIT_EVENT_TYPES.CA_REQUEST_APPROVED
  | typeof AUDIT_EVENT_TYPES.CA_REQUEST_RETRIED
  | typeof AUDIT_EVENT_TYPES.CA_CERTIFICATE_REVOKED;

function auditActorType(subject: SecuritySubject): WriteAuditInput['actorType'] {
  if (subject.type === 'group' || subject.type === 'role') {
    throw new Error('组和角色不能作为 CA 运营审计操作者');
  }
  return subject.type;
}
