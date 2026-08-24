import type { App } from './app.js';

/**
 * 测试使用可读的 Bearer 载荷模拟已经完成身份解析的请求。
 * 该夹具只注册测试应用自己的 resolver，生产认证实现不会读取这种格式。
 */
export function configureTestAuth(app: App): App {
  app.setAuthTokenResolver((authorization) => {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    const separator = token?.indexOf('|') ?? -1;
    if (!token || separator <= 0 || separator === token.length - 1) return undefined;
    const actorId = token.slice(0, separator);
    const tenantId = token.slice(separator + 1);
    return actorId && tenantId ? { actorId, tenantId } : undefined;
  });
  return app;
}

export function testAuthHeaders(
  actorId: string,
  tenantId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    authorization: `Bearer ${actorId}|${tenantId}`,
    ...extra,
  };
}
