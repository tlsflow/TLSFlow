import { AppError } from '../errors/app-error.js';
import type { HttpRequest } from './http-types.js';

const ZERO_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const LEGACY_TENANT_FALLBACK = 'tenant_default';

/**
 * 读取已经由请求上下文装配的租户。
 *
 * 业务控制器不能自行猜测默认租户，也不能把无效租户降级成 UUID 零值。
 * 当前阶段仍允许测试和兼容入口传递逻辑租户编码，统一解析由认证/租户
 * 身份服务负责；这里仅负责拒绝缺失和历史占位值。
 */
export function requireTenantId(request: Pick<HttpRequest, 'context'>): string {
  const tenantId = request.context.tenantId?.trim();
  if (!tenantId) {
    throw new AppError('AUTH_UNAUTHENTICATED', '缺少租户上下文');
  }
  if (tenantId === ZERO_TENANT_ID || tenantId === LEGACY_TENANT_FALLBACK) {
    throw new AppError('AUTH_FORBIDDEN', '租户上下文无效', { tenantId });
  }
  return tenantId;
}
