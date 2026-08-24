export const AUDIT_EVENT_TYPES = {
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILURE: 'auth.login.failure',
  SECRET_CREATED: 'secret.created',
  SECRET_VERSION_CREATED: 'secret.version.created',
  SECRET_USED: 'secret.used',
  SECRET_ROTATED: 'secret.rotated',
  PERMISSION_DENIED: 'permission.denied',
  APPROVAL_CREATED: 'approval.created',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  CERTIFICATE_IMPORTED: 'certificate.imported',
  DEPLOYMENT_CREATED: 'deployment.created',
  DEPLOYMENT_EXECUTED: 'deployment.executed',
  DEPLOYMENT_ROLLBACK_REQUESTED: 'deployment.rollback_requested',
  PLUGIN_INSTALLED: 'plugin.installed',
  PLUGIN_PERMISSION_DENIED: 'plugin.permission_denied',
  WORKFLOW_TEMPLATE_EXECUTED: 'workflow_template.executed',
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

export const HIGH_RISK_AUDIT_EVENTS = new Set<string>([
  AUDIT_EVENT_TYPES.SECRET_USED,
  AUDIT_EVENT_TYPES.SECRET_ROTATED,
  AUDIT_EVENT_TYPES.APPROVAL_APPROVED,
  AUDIT_EVENT_TYPES.APPROVAL_REJECTED,
  AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTED,
  AUDIT_EVENT_TYPES.DEPLOYMENT_ROLLBACK_REQUESTED,
  AUDIT_EVENT_TYPES.PLUGIN_INSTALLED,
  AUDIT_EVENT_TYPES.PLUGIN_PERMISSION_DENIED,
  AUDIT_EVENT_TYPES.WORKFLOW_TEMPLATE_EXECUTED,
]);
