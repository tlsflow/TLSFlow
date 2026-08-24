import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from '../../modules/security/security.controller.js';

function requireInitialAdminPassword(): string {
  const password = process.env.GCAC_INITIAL_ADMIN_PASSWORD?.trim();
  assert.ok(password, '测试环境必须显式设置 GCAC_INITIAL_ADMIN_PASSWORD');
  return password;
}

describe('HTTP 身份上下文装配', () => {
  it('匿名请求伪造 actor 和租户请求头必须失败', async () => {
    const app = createApp({ security: createSecurityServices() });

    const response = await app.inject({
      method: 'GET',
      path: '/api/v1/auth/me',
      headers: {
        'X-Actor-Id': 'user_admin',
        'X-Tenant-Id': 'tenant_attacker',
      },
    });

    assert.equal(response.statusCode, 401);
    assert.equal((response.body as { errorCode: string }).errorCode, 'AUTH_UNAUTHENTICATED');
  });

  it('无效 Bearer Token 不得回落到请求头身份', async () => {
    const app = createApp({ security: createSecurityServices() });

    const response = await app.inject({
      method: 'GET',
      path: '/api/v1/auth/me',
      headers: {
        authorization: 'Bearer invalid-token',
        'X-Actor-Id': 'user_admin',
        'X-Tenant-Id': 'tenant_attacker',
      },
    });

    assert.equal(response.statusCode, 401);
    assert.equal((response.body as { errorCode: string }).errorCode, 'AUTH_UNAUTHENTICATED');
  });

  it('有效 Token 与冲突请求头同时存在时以服务端身份上下文为准', async () => {
    const adminPassword = requireInitialAdminPassword();
    const app = createApp({ security: createSecurityServices() });
    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: adminPassword },
    });
    assert.equal(login.statusCode, 200);

    const loginUser = (login.body as { user: { id: string; tenantId: string } }).user;
    const token = (login.body as { token: string }).token;
    const response = await app.inject({
      method: 'GET',
      path: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
        'X-Actor-Id': 'attacker',
        'X-Tenant-Id': 'tenant_attacker',
      },
    });

    assert.equal(response.statusCode, 200);
    const user = (response.body as { user: { id: string; tenantId: string } }).user;
    assert.equal(user.id, loginUser.id);
    assert.equal(user.tenantId, loginUser.tenantId);
  });
});
