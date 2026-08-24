import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createPersistedSecurityServices } from './security-services.persistence.js';

describe('租户架构聚合 API', () => {
  it('仅返回集团管理员管理范围内的两级树，并过滤撤销和过期管理员', async () => {
    const fixture = await createFixture('hierarchical');
    const response = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/architecture',
      headers: { authorization: `Bearer ${await fixture.login('group-admin', 'group-admin-pass')}` },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body as {
      mode: string;
      roots: Array<{
        id: string;
        type: string;
        administrators: Array<{ subjectId: string }>;
        children: Array<{ id: string; type: string; administrators: Array<{ subjectId: string }> }>;
      }>;
    };
    assert.equal(body.mode, 'hierarchical');
    assert.equal(body.roots.length, 1);
    assert.equal(body.roots[0]?.id, fixture.group.id);
    assert.equal(body.roots[0]?.type, 'GROUP');
    assert.deepEqual(body.roots[0]?.children.map((item) => [item.id, item.type]).sort(), [
      [fixture.companyA.id, 'COMPANY'],
      [fixture.companyB.id, 'COMPANY'],
    ].sort());
    const companyB = body.roots[0]?.children.find((item) => item.id === fixture.companyB.id);
    assert.equal(companyB?.administrators.some((item) => item.subjectId === fixture.revokedAdministratorId), false);
    assert.equal(companyB?.administrators.some((item) => item.subjectId === fixture.expiredAdministratorId), false);
  });

  it('分子公司管理员只能看到自身，兄弟租户不可见，停用租户仅以状态标记返回', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.security.tenantHierarchy?.setStatus(fixture.companyB.id, 'SUSPENDED', 'user_group_admin', fixture.group.id);

    const groupResponse = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/architecture',
      headers: { authorization: `Bearer ${await fixture.login('group-admin', 'group-admin-pass')}` },
    });
    assert.equal(groupResponse.statusCode, 200);
    const groupBody = groupResponse.body as { roots: Array<{ children: Array<{ id: string; status: string }> }> };
    assert.equal(groupBody.roots[0]?.children.find((item) => item.id === fixture.companyB.id)?.status, 'SUSPENDED');

    const companyResponse = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/architecture',
      headers: { authorization: `Bearer ${await fixture.login('company-admin', 'company-admin-pass')}` },
    });
    assert.equal(companyResponse.statusCode, 200);
    const companyBody = companyResponse.body as { roots: Array<{ id: string; children: unknown[] }> };
    assert.deepEqual(companyBody.roots.map((item) => item.id), [fixture.companyA.id]);
    assert.deepEqual(companyBody.roots[0]?.children, []);
  });

  it('single 模式返回空根节点，未认证和无 tenant.manage 权限请求失败关闭', async () => {
    const fixture = await createFixture('single');
    const single = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/architecture',
      headers: { authorization: `Bearer ${await fixture.login('group-admin', 'group-admin-pass')}` },
    });
    assert.equal(single.statusCode, 200);
    assert.deepEqual(single.body, {
      mode: 'single',
      currentTenantId: fixture.group.id,
      contextVersion: (single.body as { contextVersion: string }).contextVersion,
      managementScope: (single.body as { managementScope?: unknown }).managementScope,
      roots: [],
    });

    const unauthenticated = await fixture.app.inject({ method: 'GET', path: '/api/v1/tenants/architecture' });
    assert.equal(unauthenticated.statusCode, 401);

    const denied = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/architecture?tenantId=not-accepted',
      headers: { authorization: `Bearer ${await fixture.login('member', 'member-pass')}` },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal((denied.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
  });
});

async function createFixture(mode: 'single' | 'hierarchical') {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: `tenant-architecture-api-${mode}`,
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const security = createPersistedSecurityServices(db, { initialTenantMode: mode }).services;
  await security.tenantMode?.getCurrentMode();
  const app = createApp({ db, security, corePersistence: { mode: 'memory' } });
  const group = (await security.tenantHierarchy!.listTenants()).find((tenant) => tenant.code === 'default');
  assert.ok(group);
  const companyA = await security.tenantHierarchy!.createTenant({ name: '公司 A', code: `architecture-a-${mode}`, type: 'COMPANY', parentId: group.id, actorId: 'user_admin', contextTenantId: group.id });
  const companyB = await security.tenantHierarchy!.createTenant({ name: '公司 B', code: `architecture-b-${mode}`, type: 'COMPANY', parentId: group.id, actorId: 'user_admin', contextTenantId: group.id });

  await Promise.all([
    security.auth.createUserWithPassword({ id: 'architecture_group_admin', username: 'group-admin', displayName: '集团管理员', password: 'group-admin-pass', status: 'active', tenantId: group.id, tenantName: group.name }),
    security.auth.createUserWithPassword({ id: 'architecture_company_admin', username: 'company-admin', displayName: '公司管理员', password: 'company-admin-pass', status: 'active', tenantId: companyA.id, tenantName: companyA.name }),
    security.auth.createUserWithPassword({ id: 'architecture_member', username: 'member', displayName: '普通成员', password: 'member-pass', status: 'active', tenantId: group.id, tenantName: group.name }),
    security.auth.createUserWithPassword({ id: 'architecture_revoked_admin', username: 'revoked-admin', displayName: '已撤销管理员', password: 'revoked-admin-pass', status: 'active', tenantId: companyB.id, tenantName: companyB.name }),
    security.auth.createUserWithPassword({ id: 'architecture_expired_admin', username: 'expired-admin', displayName: '已过期管理员', password: 'expired-admin-pass', status: 'active', tenantId: companyB.id, tenantName: companyB.name }),
  ]);

  const groupMembership = await security.tenantHierarchy!.addMembership({ subjectType: 'user', subjectId: 'architecture_group_admin', tenantId: group.id, membershipType: 'admin', actorId: 'user_admin', contextTenantId: group.id });
  await security.tenantHierarchy!.addMembership({ subjectType: 'user', subjectId: 'architecture_company_admin', tenantId: companyA.id, membershipType: 'admin', actorId: 'user_admin', contextTenantId: group.id });
  await security.tenantHierarchy!.addMembership({ subjectType: 'user', subjectId: 'architecture_member', tenantId: group.id, membershipType: 'member', actorId: 'user_admin', contextTenantId: group.id });
  const revoked = await security.tenantHierarchy!.addMembership({ subjectType: 'user', subjectId: 'architecture_revoked_admin', tenantId: companyB.id, membershipType: 'admin', actorId: 'user_admin', contextTenantId: group.id });
  await security.tenantHierarchy!.revokeMembership(revoked.id, 'user_admin', new Date().toISOString(), group.id);
  await security.tenantHierarchy!.addMembership({ subjectType: 'user', subjectId: 'architecture_expired_admin', tenantId: companyB.id, membershipType: 'owner', actorId: 'user_admin', contextTenantId: group.id, effectiveFrom: '1999-01-01T00:00:00.000Z', effectiveUntil: '2000-01-01T00:00:00.000Z' });

  await security.rbac.createPolicy({
    id: `architecture-group-policy-${mode}`,
    subjectType: 'user',
    subjectId: 'architecture_group_admin',
    effect: 'allow',
    actions: ['tenant.manage'],
    resourceTypes: ['tenant'],
    scope: { tenantScope: { type: 'SUBTREE', rootTenantId: group.id, tenantIds: [group.id, companyA.id, companyB.id] } },
  });
  await security.rbac.createPolicy({
    id: `architecture-company-policy-${mode}`,
    subjectType: 'user',
    subjectId: 'architecture_company_admin',
    effect: 'allow',
    actions: ['tenant.manage'],
    resourceTypes: ['tenant'],
    scope: { tenantId: companyA.id },
  });

  return {
    app,
    security,
    group,
    companyA,
    companyB,
    revokedAdministratorId: 'architecture_revoked_admin',
    expiredAdministratorId: 'architecture_expired_admin',
    login: async (username: string, password: string) => {
      const response = await app.inject({ method: 'POST', path: '/api/v1/auth/login', body: { username, password } });
      assert.equal(response.statusCode, 200);
      return (response.body as { token: string }).token;
    },
  };
}
