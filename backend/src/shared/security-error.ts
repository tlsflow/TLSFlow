export class SecurityError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus = 422,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

export const securityErrors = {
  permissionDenied: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_PERMISSION_DENIED', '权限不足，无法执行该操作', 403, details),
  secretNotFound: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_SECRET_NOT_FOUND', 'Secret 不存在或不可见', 404, details),
  secretResolveDenied: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_SECRET_RESOLVE_DENIED', 'Secret 明文解析被拒绝', 403, details),
  approvalRequired: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_APPROVAL_REQUIRED', '操作需要审批', 422, details),
  approvalInvalid: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_APPROVAL_INVALID', '审批无效或状态不允许', 409, details),
  auditWriteFailed: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_AUDIT_WRITE_FAILED', '审计日志写入失败', 500, details),
  redactionFailed: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_REDACTION_FAILED', '日志脱敏失败', 500, details),
  executorGrantDenied: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_EXECUTOR_GRANT_DENIED', '执行器授权失败', 403, details),
  pluginPermissionDenied: (details: Record<string, unknown> = {}) =>
    new SecurityError('SEC_PLUGIN_PERMISSION_DENIED', '插件权限不足', 403, details),
  secretRefInvalid: (details: Record<string, unknown> = {}) =>
    new SecurityError('SECRET_REF_INVALID', 'Secret 引用无效', 422, details),
};
