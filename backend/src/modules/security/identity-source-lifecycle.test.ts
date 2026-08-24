import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from './security.controller.js';

describe('IdentitySource 生命周期', () => {
  it('支持编辑和删除身份源', async () => {
    const security = createSecurityServices();
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
    });
    const token = (login.body as { token: string }).token;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: '初始 LDAP',
        type: 'ldap',
        url: 'ldap://ldap.example.test:389',
        baseDn: 'dc=example,dc=test',
        requireGroupMapping: false,
        tlsMode: 'none',
      },
    });
    assert.equal(created.statusCode, 201);
    const sourceId = (created.body as { id: string }).id;

    const updated = await app.inject({
      method: 'PATCH',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        id: sourceId,
        name: '更新后的 LDAP',
        url: 'ldaps://ldap.example.test:636',
        tlsMode: 'ldaps',
        bindDn: 'CN=svc,OU=Users,DC=example,DC=test',
      },
    });
    assert.equal(updated.statusCode, 200);
    const updatedBody = updated.body as { name: string; url: string; tlsMode: string; bindDn: string };
    assert.equal(updatedBody.name, '更新后的 LDAP');
    assert.equal(updatedBody.url, 'ldaps://ldap.example.test:636');
    assert.equal(updatedBody.tlsMode, 'ldaps');
    assert.equal(updatedBody.bindDn, 'CN=svc,OU=Users,DC=example,DC=test');

    const deleted = await app.inject({
      method: 'DELETE',
      path: '/api/v1/security/identity-sources/delete',
      headers: { authorization: `Bearer ${token}` },
      body: { id: sourceId },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal((deleted.body as { deleted: boolean }).deleted, true);

    const list = await app.inject({
      method: 'GET',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(list.statusCode, 200);
    const items = (list.body as { items: Array<{ id: string }> }).items;
    assert.equal(items.some((item) => item.id === sourceId), false);
  });

  it('存在外部影子用户引用时拒绝删除且保留身份源和组映射', async () => {
    const security = createSecurityServices();
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
    });
    const token = (login.body as { token: string }).token;

    const role = await app.inject({
      method: 'POST',
      path: '/api/v1/security/roles',
      headers: { authorization: `Bearer ${token}` },
      body: { code: 'identity_source_user', name: '身份源用户角色' },
    });
    const roleId = (role.body as { id: string }).id;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: '被引用 LDAP',
        type: 'ldap',
        url: 'ldap://ldap.example.test:389',
        baseDn: 'dc=example,dc=test',
        requireGroupMapping: false,
        tlsMode: 'none',
      },
    });
    assert.equal(created.statusCode, 201);
    const sourceId = (created.body as { id: string }).id;

    const mapping = await app.inject({
      method: 'POST',
      path: '/api/v1/security/group-role-mappings',
      headers: { authorization: `Bearer ${token}` },
      body: {
        sourceId,
        externalGroup: 'cn=operators,dc=example,dc=test',
        roleId,
      },
    });
    assert.equal(mapping.statusCode, 201);

    await security.rbac.createUser({
      id: 'external_shadow_user',
      username: 'shadow-user',
      displayName: '影子用户',
      tenantId: 'tenant_default',
      tenantName: '默认租户',
      identityProvider: 'ldap',
      externalId: 'external-shadow-001',
      externalSourceId: sourceId,
      status: 'active',
    });

    const deleted = await app.inject({
      method: 'DELETE',
      path: '/api/v1/security/identity-sources/delete',
      headers: { authorization: `Bearer ${token}` },
      body: { id: sourceId },
    });
    assert.equal(deleted.statusCode, 400);
    assert.equal((deleted.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');

    const sourceList = await app.inject({
      method: 'GET',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(sourceList.statusCode, 200);
    assert.equal((sourceList.body as { items: Array<{ id: string }> }).items.some((item) => item.id === sourceId), true);

    const mappings = await security.externalIdentity.listMappings();
    assert.equal(mappings.some((item) => item.sourceId === sourceId), true);
  });
});
