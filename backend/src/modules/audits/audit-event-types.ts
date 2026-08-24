export const AUDIT_EVENT_TYPES = {
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILURE: 'auth.login.failure',
  AUTH_LOGIN_FAILED: 'auth.login.failed',
  AUTH_LOGOUT: 'auth.logout',
  SECURITY_USER_CREATED: 'security.user.created',
  SECURITY_USER_UPDATED: 'security.user.updated',
  SECURITY_USER_DELETED: 'security.user.deleted',
  SECURITY_USER_STATUS_CHANGED: 'security.user.status_changed',
  SECURITY_USER_ROLE_ASSIGNED: 'security.user.role_assigned',
  SECURITY_ROLE_CREATED: 'security.role.created',
  SECURITY_ROLE_DELETED: 'security.role.deleted',
  SECURITY_PERMISSION_POLICY_CREATED: 'security.permission_policy.created',
  TENANT_CREATED: 'tenant.created',
  TENANT_STATUS_CHANGED: 'tenant.status.changed',
  TENANT_CONTEXT_SWITCHED: 'tenant.context.switched',
  TENANT_ARCHITECTURE_QUERIED: 'tenant.architecture.queried',
  TENANT_MODE_PREFLIGHT_COMPLETED: 'tenant.mode.preflight.completed',
  TENANT_MODE_ENABLED: 'tenant.mode.enabled',
  TENANT_MODE_ENABLE_FAILED: 'tenant.mode.enable.failed',
  TENANT_MODE_ROLLED_BACK: 'tenant.mode.rolled_back',
  TENANT_MODE_ROLLBACK_FAILED: 'tenant.mode.rollback.failed',
  TENANT_MEMBERSHIP_CREATED: 'tenant.membership.created',
  TENANT_MEMBERSHIP_REVOKED: 'tenant.membership.revoked',
  TENANT_MEMBERSHIP_EXPIRED: 'tenant.membership.expired',
  IDENTITY_SOURCE_CREATED: 'security.identity_source.created',
  IDENTITY_SOURCE_UPDATED: 'security.identity_source.updated',
  IDENTITY_SOURCE_DELETED: 'security.identity_source.deleted',
  IDENTITY_GROUP_MAPPING_CREATED: 'security.identity_group_mapping.created',
  IDENTITY_SOURCE_TESTED: 'security.identity_source.tested',
  IDENTITY_SOURCE_SYNCED: 'security.identity_source.synced',
  EXTERNAL_LOGIN_SUCCESS: 'auth.external_login.success',
  EXTERNAL_LOGIN_FAILED: 'auth.external_login.failed',
  SECRET_CREATED: 'secret.created',
  SECRET_VERSION_CREATED: 'secret.version.created',
  SECRET_USED: 'secret.used',
  SECRET_ROTATED: 'secret.rotated',
  SECRET_DELETED: 'secret.deleted',
  PERMISSION_DENIED: 'permission.denied',
  APPROVAL_CREATED: 'approval.created',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  CERTIFICATE_IMPORTED: 'certificate.imported',
  CA_OPERATIONS_RECORD_READ: 'ca.operations.record.read',
  CA_OPERATIONS_EXPORTED: 'ca.operations.exported',
  CA_OPERATIONS_SYNC_STARTED: 'ca.operations.sync.started',
  CA_OPERATIONS_SYNC_COMPLETED: 'ca.operations.sync.completed',
  CA_OPERATIONS_SYNC_FAILED: 'ca.operations.sync.failed',
  CA_TEMPLATE_MAPPING_CREATED: 'ca.template.mapping.created',
  CA_TEMPLATE_MAPPING_UPDATED: 'ca.template.mapping.updated',
  CA_REQUEST_APPROVED: 'ca.request.approved',
  CA_REQUEST_RETRIED: 'ca.request.retried',
  CA_CERTIFICATE_REVOKED: 'ca.certificate.revoked',
  DEPLOYMENT_CREATED: 'deployment.created',
  DEPLOYMENT_EXECUTED: 'deployment.executed',
  DEPLOYMENT_ROLLBACK_REQUESTED: 'deployment.rollback_requested',
  DEPLOYMENT_TEMPORARY_PLAN_ARCHIVED: 'deployment.temporary_plan.archived',
  PLUGIN_INSTALLED: 'plugin.installed',
  PLUGIN_PERMISSION_DENIED: 'plugin.permission_denied',
  WORKFLOW_TEMPLATE_EXECUTED: 'workflow_template.executed',
  AUTOMATION_CREATED: 'automation.created',
  AUTOMATION_UPDATED: 'automation.updated',
  AUTOMATION_COPIED: 'automation.copied',
  AUTOMATION_ENABLED: 'automation.enabled',
  AUTOMATION_DISABLED: 'automation.disabled',
  AUTOMATION_DELETED: 'automation.deleted',
  AUTOMATION_EXECUTED: 'automation.executed',
  AUTOMATION_STOPPED: 'automation.stopped',
  AUTOMATION_RETRIED: 'automation.retried',
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

/**
 * 这些事件是高频执行细节或默认拒绝噪声，不进入长期审计列表。
 * CA 同步失败和有明确策略阻断原因的权限拒绝必须保留，便于定位真实故障。
 */
export function isSuppressedAudit(input: {
  eventType?: unknown;
  resourceType?: unknown;
  detail?: unknown;
}): boolean {
  const eventType = typeof input.eventType === 'string' ? input.eventType : '';
  const isCaSyncFailure = eventType === AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_FAILED;
  return eventType === AUDIT_EVENT_TYPES.SECRET_USED
    || isSuppressedPermissionDeniedAudit(input)
    || (eventType.startsWith('ca.operations.sync.') && !isCaSyncFailure)
    || (input.resourceType === 'caSyncRun' && !isCaSyncFailure);
}

/** 默认拒绝表示没有命中任何允许策略，通常是列表探测产生的重复噪声。 */
export function isSuppressedPermissionDeniedAudit(input: {
  eventType?: unknown;
  detail?: unknown;
}): boolean {
  if (input.eventType !== AUDIT_EVENT_TYPES.PERMISSION_DENIED) return false;
  const reason = readDetailString(input.detail, 'reason');
  return reason === 'no allow policy' || reason === 'no object grant';
}

/** Secret 读取事件全部属于执行细节，不进入长期审计列表。 */
export function isSecretUsageAudit(input: { eventType?: unknown }): boolean {
  return input.eventType === AUDIT_EVENT_TYPES.SECRET_USED;
}

/** HTTP 请求头中的 Secret 读取属于 Secret 使用事件的一个兼容性细分。 */
export function isHttpHeaderSecretReadAudit(input: {
  eventType?: unknown;
  action?: unknown;
  resourceType?: unknown;
  detail?: unknown;
}): boolean {
  if (input.eventType !== AUDIT_EVENT_TYPES.SECRET_USED
    || input.action !== 'secret.resolve.service'
    || input.resourceType !== 'secret') return false;
  return readDetailString(input.detail, 'purpose') === 'http.header';
}

function readDetailString(detail: unknown, key: string): string | undefined {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

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
