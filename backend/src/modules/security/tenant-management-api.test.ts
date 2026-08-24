import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createPersistedSecurityServices } from './security-services.persistence.js';

describe('租户治理 API', () => {
  it('具备多个直接成员关系的用户可以查询上下文并切换当前租户', async () => {
    const fixture = await createFixture('hierarchical');
    const token = await fixture.login('switch-user', 'switch-user-pass');

    const accessible = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/accessible',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(accessible.statusCode, 200);
    const accessibleBody = accessible.body as {
      currentTenantId: string;
      items: Array<{ tenantId: string; canSwitch: boolean; current: boolean }>;
      version: string;
    };
    assert.equal(accessibleBody.currentTenantId, fixture.defaultTenant.id);
    assert.deepEqual(
      accessibleBody.items.map((item) => [item.tenantId, item.canSwitch]),
      [
        [fixture.companyA.id, true],
        [fixture.defaultTenant.id, true],
      ],
    );

    const currentBefore = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenant-context/current',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(currentBefore.statusCode, 200);
    assert.equal((currentBefore.body as { currentTenant: { id: string } }).currentTenant.id, fixture.defaultTenant.id);

    const switched = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/tenant-context/switch',
      headers: { authorization: `Bearer ${token}` },
      body: {
        tenantId: fixture.companyA.id,
        contextVersion: accessibleBody.version,
      },
    });
    assert.equal(switched.statusCode, 200);
    const switchedBody = switched.body as { currentTenantId: string; token: string };
    assert.equal(switchedBody.currentTenantId, fixture.companyA.id);

    const currentAfter = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenant-context/current',
      headers: { authorization: `Bearer ${switchedBody.token}` },
    });
    assert.equal(currentAfter.statusCode, 200);
    assert.equal((currentAfter.body as { currentTenant: { id: string } }).currentTenant.id, fixture.companyA.id);
  });

  it('集团管理员可以管理子树内租户、成员并留下审计证据', async () => {
    const fixture = await createFixture('hierarchical');
    const groupToken = await fixture.login('group-admin', 'group-admin-pass');
    const adminToken = await fixture.login('admin', fixture.adminPassword);

    const current = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/current',
      headers: { authorization: `Bearer ${groupToken}` },
    });
    assert.equal(current.statusCode, 200);
    assert.equal((current.body as { tenant: { id: string } }).tenant.id, fixture.defaultTenant.id);

    const tree = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/tree',
      headers: { authorization: `Bearer ${groupToken}` },
    });
    assert.equal(tree.statusCode, 200);
    const treeBody = tree.body as {
      items: Array<{ id: string; children: Array<{ id: string }> }>;
      managementScope: { type: string; tenantIds: string[] };
    };
    assert.equal(treeBody.managementScope.type, 'SUBTREE');
    assert.equal(treeBody.managementScope.tenantIds.includes(fixture.companyA.id), true);
    assert.equal(treeBody.managementScope.tenantIds.includes(fixture.companyB.id), true);
    assert.equal(treeBody.items.length, 1);
    assert.equal(treeBody.items[0]?.id, fixture.defaultTenant.id);
    assert.deepEqual(
      treeBody.items[0]?.children.map((item) => item.id).sort(),
      [fixture.companyA.id, fixture.companyB.id].sort(),
    );

    const created = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/tenants',
      headers: { authorization: `Bearer ${groupToken}` },
      body: {
        name: '集团新子公司',
        code: 'group-child-new',
      },
    });
    assert.equal(created.statusCode, 201);
    const createdTenantId = ((created.body as { tenant: { id: string } }).tenant.id);

    const membershipCreated = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/tenant-memberships',
      headers: { authorization: `Bearer ${groupToken}` },
      body: {
        tenantId: fixture.companyB.id,
        subjectType: 'user',
        subjectId: fixture.memberUserId,
        membershipType: 'member',
      },
    });
    assert.equal(membershipCreated.statusCode, 201);
    const membershipId = (membershipCreated.body as { membership: { id: string } }).membership.id;

    const membershipList = await fixture.app.inject({
      method: 'GET',
      path: `/api/v1/tenant-memberships?tenantId=${fixture.companyB.id}`,
      headers: { authorization: `Bearer ${groupToken}` },
    });
    assert.equal(membershipList.statusCode, 200);
    assert.equal((membershipList.body as { total: number }).total, 1);

    const suspended = await fixture.app.inject({
      method: 'PATCH',
      path: '/api/v1/tenants/status',
      headers: { authorization: `Bearer ${groupToken}` },
      body: { tenantId: fixture.companyB.id, status: 'SUSPENDED' },
    });
    assert.equal(suspended.statusCode, 200);
    assert.equal((suspended.body as { tenant: { status: string } }).tenant.status, 'SUSPENDED');

    const resumed = await fixture.app.inject({
      method: 'PATCH',
      path: '/api/v1/tenants/status',
      headers: { authorization: `Bearer ${groupToken}` },
      body: { tenantId: fixture.companyB.id, status: 'ACTIVE' },
    });
    assert.equal(resumed.statusCode, 200);
    assert.equal((resumed.body as { tenant: { status: string } }).tenant.status, 'ACTIVE');

    const revoked = await fixture.app.inject({
      method: 'DELETE',
      path: '/api/v1/tenant-memberships',
      headers: { authorization: `Bearer ${groupToken}` },
      body: { membershipId },
    });
    assert.equal(revoked.statusCode, 200);
    assert.equal((revoked.body as { membership: { status: string } }).membership.status, 'REVOKED');

    const tenantAudits = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/audit-events?resourceType=tenant&actorId=user_group_admin',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(tenantAudits.statusCode, 200);
    const tenantAuditBody = tenantAudits.body as { items: Array<{ eventType: string; resourceId?: string }> };
    assert.equal(tenantAuditBody.items.some((item) => item.eventType === 'tenant.created' && item.resourceId === createdTenantId), true);
    assert.equal(tenantAuditBody.items.some((item) => item.eventType === 'tenant.status.changed' && item.resourceId === fixture.companyB.id), true);

    const membershipAudits = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/audit-events?resourceType=tenantMembership&actorId=user_group_admin',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(membershipAudits.statusCode, 200);
    const membershipAuditBody = membershipAudits.body as { items: Array<{ eventType: string; resourceId?: string }> };
    assert.equal(membershipAuditBody.items.some((item) => item.eventType === 'tenant.membership.created'), true);
    assert.equal(membershipAuditBody.items.some((item) => item.eventType === 'tenant.membership.revoke' || item.eventType === 'tenant.membership.revoked'), true);
  });

  it('分子公司管理员只允许管理自身，不能管理集团或兄弟租户', async () => {
    const fixture = await createFixture('hierarchical');
    const token = await fixture.login('company-admin', 'company-admin-pass');

    const tree = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/tree',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(tree.statusCode, 200);
    const treeBody = tree.body as { items: Array<{ id: string; children: unknown[] }>; managementScope: { type: string; tenantIds: string[] } };
    assert.equal(treeBody.managementScope.type, 'SELF');
    assert.deepEqual(treeBody.managementScope.tenantIds, [fixture.companyA.id]);
    assert.deepEqual(treeBody.items.map((item) => item.id), [fixture.companyA.id]);
    assert.deepEqual(treeBody.items[0]?.children ?? [], []);

    const allowed = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/tenant-memberships',
      headers: { authorization: `Bearer ${token}` },
      body: {
        tenantId: fixture.companyA.id,
        subjectType: 'user',
        subjectId: fixture.memberUserId,
        membershipType: 'member',
      },
    });
    assert.equal(allowed.statusCode, 201);

    const deniedSibling = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/tenant-memberships',
      headers: { authorization: `Bearer ${token}` },
      body: {
        tenantId: fixture.companyB.id,
        subjectType: 'user',
        subjectId: fixture.otherMemberUserId,
        membershipType: 'member',
      },
    });
    assert.equal(deniedSibling.statusCode, 403);
    assert.equal((deniedSibling.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');

    const deniedGroup = await fixture.app.inject({
      method: 'PATCH',
      path: '/api/v1/tenants/status',
      headers: { authorization: `Bearer ${token}` },
      body: { tenantId: fixture.defaultTenant.id, status: 'SUSPENDED' },
    });
    assert.equal(deniedGroup.statusCode, 403);
    assert.equal((deniedGroup.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
  });

  it('single 模式仍固定默认租户并对未认证请求失败关闭', async () => {
    const fixture = await createFixture('single');
    const token = await fixture.login('group-admin', 'group-admin-pass');

    const accessible = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/accessible',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': fixture.companyA.id,
      },
    });
    assert.equal(accessible.statusCode, 200);
    const accessibleBody = accessible.body as { currentTenantId: string; items: Array<{ tenantId: string }>; version: string };
    assert.equal(accessibleBody.currentTenantId, fixture.defaultTenant.id);
    assert.deepEqual(accessibleBody.items.map((item) => item.tenantId), [fixture.defaultTenant.id]);

    const current = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenant-context/current',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(current.statusCode, 200);
    assert.equal((current.body as { currentTenant: { id: string } }).currentTenant.id, fixture.defaultTenant.id);

    const switched = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/tenant-context/switch',
      headers: { authorization: `Bearer ${token}` },
      body: {
        tenantId: fixture.companyA.id,
        contextVersion: accessibleBody.version,
      },
    });
    assert.equal(switched.statusCode, 403);
    assert.equal((switched.body as { errorCode: string }).errorCode, 'TENANT_SCOPE_DENIED');

    const unauthenticated = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/tenants/current',
    });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal((unauthenticated.body as { errorCode: string }).errorCode, 'AUTH_UNAUTHENTICATED');
  });
});

async function createFixture(mode: 'single' | 'hierarchical') {
  const previousMode = process.env.GCAC_TENANT_MODE;
  process.env.GCAC_TENANT_MODE = mode;

  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: `tenant-management-api-${mode}`,
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const security = createPersistedSecurityServices(db).services;
  const app = createApp({ db, security, corePersistence: { mode: 'memory' } });
  const adminPassword = process.env.GCAC_INITIAL_ADMIN_PASSWORD ?? 'admin12345';

  const tenants = await security.tenantHierarchy!.listTenants();
  const defaultTenant = tenants.find((tenant) => tenant.code === 'default');
  assert.ok(defaultTenant);

  const companyA = await security.tenantHierarchy!.createTenant({
    name: '公司 A',
    code: `company-a-${mode}`,
    type: 'COMPANY',
    parentId: defaultTenant.id,
    actorId: 'user_admin',
    contextTenantId: defaultTenant.id,
  });
  const companyB = await security.tenantHierarchy!.createTenant({
    name: '公司 B',
    code: `company-b-${mode}`,
    type: 'COMPANY',
    parentId: defaultTenant.id,
    actorId: 'user_admin',
    contextTenantId: defaultTenant.id,
  });

  await security.auth.createUserWithPassword({
    id: 'user_group_admin',
    username: 'group-admin',
    displayName: '集团管理员',
    password: 'group-admin-pass',
    status: 'active',
    tenantId: defaultTenant.id,
    tenantName: defaultTenant.name,
  });
  await security.auth.createUserWithPassword({
    id: 'user_company_admin',
    username: 'company-admin',
    displayName: '公司管理员',
    password: 'company-admin-pass',
    status: 'active',
    tenantId: companyA.id,
    tenantName: companyA.name,
  });
  await security.auth.createUserWithPassword({
    id: 'user_switch_user',
    username: 'switch-user',
    displayName: '切换用户',
    password: 'switch-user-pass',
    status: 'active',
    tenantId: defaultTenant.id,
    tenantName: defaultTenant.name,
  });
  await security.auth.createUserWithPassword({
    id: 'user_member_target',
    username: 'member-target',
    displayName: '成员目标',
    password: 'member-target-pass',
    status: 'active',
    tenantId: companyA.id,
    tenantName: companyA.name,
  });
  await security.auth.createUserWithPassword({
    id: 'user_member_other',
    username: 'member-other',
    displayName: '其他成员目标',
    password: 'member-other-pass',
    status: 'active',
    tenantId: companyB.id,
    tenantName: companyB.name,
  });

  await security.tenantHierarchy!.addMembership({
    subjectType: 'user',
    subjectId: 'user_group_admin',
    tenantId: defaultTenant.id,
    membershipType: 'admin',
    actorId: 'user_admin',
    contextTenantId: defaultTenant.id,
  });
  await security.tenantHierarchy!.addMembership({
    subjectType: 'user',
    subjectId: 'user_company_admin',
    tenantId: companyA.id,
    membershipType: 'admin',
    actorId: 'user_admin',
    contextTenantId: defaultTenant.id,
  });
  await security.tenantHierarchy!.addMembership({
    subjectType: 'user',
    subjectId: 'user_switch_user',
    tenantId: defaultTenant.id,
    membershipType: 'member',
    actorId: 'user_admin',
    contextTenantId: defaultTenant.id,
  });
  await security.tenantHierarchy!.addMembership({
    subjectType: 'user',
    subjectId: 'user_switch_user',
    tenantId: companyA.id,
    membershipType: 'member',
    actorId: 'user_admin',
    contextTenantId: defaultTenant.id,
  });

  await security.rbac.createPolicy({
    id: `policy-group-manage-${mode}`,
    subjectType: 'user',
    subjectId: 'user_group_admin',
    effect: 'allow',
    actions: ['tenant.manage'],
    resourceTypes: ['tenant'],
    scope: {
      tenantScope: {
        type: 'SUBTREE',
        rootTenantId: defaultTenant.id,
        tenantIds: [defaultTenant.id, companyA.id, companyB.id],
      },
    },
  });
  await security.rbac.createPolicy({
    id: `policy-company-manage-${mode}`,
    subjectType: 'user',
    subjectId: 'user_company_admin',
    effect: 'allow',
    actions: ['tenant.manage'],
    resourceTypes: ['tenant'],
    scope: {
      tenantId: companyA.id,
    },
  });

  if (previousMode === undefined) delete process.env.GCAC_TENANT_MODE;
  else process.env.GCAC_TENANT_MODE = previousMode;

  return {
    app,
    defaultTenant,
    companyA,
    companyB,
    adminPassword,
    memberUserId: 'user_member_target',
    otherMemberUserId: 'user_member_other',
    login: async (username: string, password: string) => {
      const response = await app.inject({
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { username, password },
      });
      assert.equal(response.statusCode, 200);
      return (response.body as { token: string }).token;
    },
  };
}
