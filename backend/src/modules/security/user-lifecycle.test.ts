import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from './security.controller.js';

function requireInitialAdminPassword(): string {
  const password = process.env.GCAC_INITIAL_ADMIN_PASSWORD?.trim();
  assert.ok(password, '测试环境必须显式设置 GCAC_INITIAL_ADMIN_PASSWORD');
  return password;
}

describe('User 生命周期', () => {
  it('支持编辑和删除本地用户', async () => {
    const adminPassword = requireInitialAdminPassword();
    const security = createSecurityServices();
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: adminPassword },
    });
    assert.equal(login.statusCode, 200);
    const token = (login.body as { token: string }).token;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/security/users',
      headers: { authorization: `Bearer ${token}` },
      body: {
        username: 'operator_lifecycle',
        displayName: 'Operator Lifecycle',
        password: 'operator12345',
      },
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.body as { id: string };
    const userId = createdBody.id;

    const updated = await app.inject({
      method: 'PATCH',
      path: '/api/v1/security/users',
      headers: { authorization: `Bearer ${token}` },
      body: {
        userId,
        displayName: 'Operator Lifecycle Updated',
        email: 'operator@example.test',
        status: 'disabled',
      },
    });
    assert.equal(updated.statusCode, 200);
    const updatedBody = updated.body as { displayName: string; email: string; status: string };
    assert.equal(updatedBody.displayName, 'Operator Lifecycle Updated');
    assert.equal(updatedBody.email, 'operator@example.test');
    assert.equal(updatedBody.status, 'disabled');

    const deleted = await app.inject({
      method: 'DELETE',
      path: '/api/v1/security/users/delete',
      headers: { authorization: `Bearer ${token}` },
      body: { userId },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal((deleted.body as { deleted: boolean }).deleted, true);

    const list = await app.inject({
      method: 'GET',
      path: '/api/v1/security/users',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(list.statusCode, 200);
    const items = (list.body as { items: Array<{ id: string }> }).items;
    assert.equal(items.some((item) => item.id === userId), false);
  });
});
