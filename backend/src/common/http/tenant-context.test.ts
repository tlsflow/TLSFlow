import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireTenantId } from './tenant-context.js';

function request(tenantId?: string) {
  return { context: { requestId: 'req-tenant-context', traceId: 'trace-tenant-context', tenantId } };
}

describe('requireTenantId', () => {
  it('返回已装配的租户上下文', () => {
    assert.equal(requireTenantId(request('tenant-a')), 'tenant-a');
  });

  it('缺少租户上下文时拒绝请求', () => {
    assert.throws(() => requireTenantId(request()), { errorCode: 'AUTH_UNAUTHENTICATED' });
  });

  it('拒绝历史占位租户和 UUID 零值', () => {
    assert.throws(() => requireTenantId(request('tenant_default')), { errorCode: 'AUTH_FORBIDDEN' });
    assert.throws(() => requireTenantId(request('00000000-0000-0000-0000-000000000000')), { errorCode: 'AUTH_FORBIDDEN' });
  });
});
