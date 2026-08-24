import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { AuthBrowserSessionEntity, AuthPasswordCredentialEntity } from '../../persistence/entities/auth-credential.entity.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import { AuditService } from '../audits/audit.service.js';
import { RBACService } from '../rbac/rbac.service.js';
import { AuthService } from './auth.service.js';
import { TenantHierarchyService } from './domain/tenant.domain-service.js';
import { PgTenantRepository } from './repository/tenant.repository.js';
import { TenantContextService, type TenantContextStateEntity } from './tenant-context.service.js';
import { TenantIdentityService } from './tenant-identity.service.js';
import { createPersistedSecurityServices } from './security-services.persistence.js';

describe('TenantContextService', () => {
  it('single 模式始终解析 default UUID', async () => {
    const fixture = await createFixture('single');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);

    assert.equal(context.currentTenantId, fixture.defaultTenant.id);
    assert.equal(context.homeTenantId, fixture.defaultTenant.id);
    assert.deepEqual(context.accessibleTenantIds, [fixture.defaultTenant.id]);
    assert.equal(context.mode, 'single');
  });

  it('single 模式伪造 X-Tenant-Id 不能切换租户', async () => {
    const fixture = await createFixture('single');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);

    assert.equal((await fixture.context.resolve(fixture.userId, fixture.otherTenant.id)).currentTenantId, fixture.defaultTenant.id);
    await assert.rejects(
      fixture.context.switchTenant({
        actorId: fixture.userId,
        tenantId: fixture.otherTenant.id,
        expectedVersion: context.version,
      }),
      { errorCode: 'TENANT_SCOPE_DENIED' },
    );
  });

  it('hierarchical 模式可查询用户多个有效成员租户', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'admin');
    await fixture.addMembership(fixture.otherTenant.id, 'member');

    const tenants = await fixture.context.listAccessibleTenants(fixture.userId);
    assert.deepEqual(tenants.map((item) => item.tenantId), [fixture.defaultTenant.id, fixture.otherTenant.id]);
    assert.deepEqual(tenants.map((item) => item.membershipType), ['admin', 'member']);
    assert.equal(tenants.find((item) => item.tenantId === fixture.otherTenant.id)?.scopeType, 'EXPLICIT');
    assert.equal(tenants.find((item) => item.tenantId === fixture.otherTenant.id)?.canSwitch, true);
  });

  it('集团管理员可通过子树范围看到下级公司，但不会把兄弟集团纳入范围', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'admin');
    const company = await fixture.hierarchy.createTenant({
      name: '默认集团下级公司',
      code: `company-child-${fixture.userId}`,
      type: 'COMPANY',
      parentId: fixture.defaultTenant.id,
      actorId: 'user_admin',
    });

    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);
    assert.equal(context.managementScope?.type, 'SUBTREE');
    assert.deepEqual(context.managementScope?.tenantIds?.sort(), [company.id, fixture.defaultTenant.id].sort());
    assert.equal(context.accessibleTenantIds.includes(company.id), true);

    const tenants = await fixture.context.listAccessibleTenants(fixture.userId);
    const child = tenants.find((item) => item.tenantId === company.id);
    assert.equal(child?.scopeType, 'SUBTREE');
    assert.equal(child?.membershipType, 'admin');
    assert.equal(child?.current, false);
    assert.equal(child?.canSwitch, false);
  });

  it('普通成员不会自动进入其 COMPANY', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    const company = await fixture.hierarchy.createTenant({
      name: '普通成员下级公司',
      code: `company-member-${fixture.userId}`,
      type: 'COMPANY',
      parentId: fixture.defaultTenant.id,
      actorId: 'user_admin',
    });

    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);
    assert.equal(context.managementScope?.type, 'SELF');
    assert.deepEqual(context.accessibleTenantIds, [fixture.defaultTenant.id]);

    const tenants = await fixture.context.listAccessibleTenants(fixture.userId);
    assert.equal(tenants.some((item) => item.tenantId === company.id), false);
  });

  it('REVOKED 成员不能切换', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    const revoked = await fixture.addMembership(fixture.otherTenant.id, 'member');
    await fixture.hierarchy.revokeMembership(revoked.id, 'user_admin');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);

    await assert.rejects(
      fixture.context.switchTenant({
        actorId: fixture.userId,
        tenantId: fixture.otherTenant.id,
        expectedVersion: context.version,
      }),
      { errorCode: 'TENANT_MEMBERSHIP_REQUIRED' },
    );
  });

  it('EXPIRED 成员不能切换', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    await fixture.addMembership(fixture.otherTenant.id, 'member', {
      effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      effectiveUntil: new Date(Date.now() - 1_000).toISOString(),
    });
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);

    await assert.rejects(
      fixture.context.switchTenant({
        actorId: fixture.userId,
        tenantId: fixture.otherTenant.id,
        expectedVersion: context.version,
      }),
      { errorCode: 'TENANT_MEMBERSHIP_REQUIRED' },
    );
  });

  it('effective_until 已过期的成员不能切换', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    const membership = await fixture.addMembership(fixture.otherTenant.id, 'member', {
      effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      effectiveUntil: new Date(Date.now() - 1_000).toISOString(),
    });
    assert.equal((await fixture.hierarchy.listMemberships({ subjectId: fixture.userId, status: 'EXPIRED' })).some((item) => item.id === membership.id), true);
  });

  it('停用租户不能切换', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    await fixture.addMembership(fixture.otherTenant.id, 'member');
    await fixture.hierarchy.setStatus(fixture.otherTenant.id, 'SUSPENDED');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);

    await assert.rejects(
      fixture.context.switchTenant({
        actorId: fixture.userId,
        tenantId: fixture.otherTenant.id,
        expectedVersion: context.version,
      }),
      { errorCode: 'TENANT_NOT_FOUND' },
    );
  });

  it('合法成员切换成功', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    await fixture.addMembership(fixture.otherTenant.id, 'member');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);

    const switched = await fixture.context.switchTenant({
      actorId: fixture.userId,
      tenantId: fixture.otherTenant.id,
      expectedVersion: context.version,
    });
    assert.equal(switched.currentTenantId, fixture.otherTenant.id);
  });

  it('切换后上下文 version 变化', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    await fixture.addMembership(fixture.otherTenant.id, 'member');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);
    const switched = await fixture.context.switchTenant({
      actorId: fixture.userId,
      tenantId: fixture.otherTenant.id,
      expectedVersion: context.version,
    });

    assert.notEqual(switched.version, context.version);
  });

  it('旧 version 请求失败', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    await fixture.addMembership(fixture.otherTenant.id, 'member');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);
    await fixture.context.switchTenant({
      actorId: fixture.userId,
      tenantId: fixture.otherTenant.id,
      expectedVersion: context.version,
    });

    await assert.rejects(
      fixture.context.resolve(fixture.userId, fixture.defaultTenant.id, context.version),
      { errorCode: 'TENANT_CONTEXT_STALE' },
    );
  });

  it('切换后旧租户权限上下文不能继续使用', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    await fixture.addMembership(fixture.otherTenant.id, 'member');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);
    const switched = await fixture.context.switchTenant({
      actorId: fixture.userId,
      tenantId: fixture.otherTenant.id,
      expectedVersion: context.version,
    });

    assert.equal((await fixture.context.resolve(fixture.userId, undefined, switched.version)).currentTenantId, fixture.otherTenant.id);
    await assert.rejects(
      fixture.context.resolve(fixture.userId, fixture.defaultTenant.id, context.version),
      { errorCode: 'TENANT_CONTEXT_STALE' },
    );
  });

  it('Bearer Token、浏览器 Session 和服务端上下文保持一致', async () => {
    const fixture = await createAuthFixture();
    const session = await fixture.auth.login(
      { username: fixture.username, password: 'tenant-password' },
      { requestId: 'req_login', traceId: 'trace_login' },
    );
    const parsedBefore = await fixture.auth.parseRequestIdentity(`Bearer ${session.token}`, undefined);
    assert.equal(parsedBefore?.tenantId, fixture.defaultTenant.id);

    const cookie = await fixture.auth.createBrowserSession(fixture.userId, { requestId: 'req_cookie', traceId: 'trace_cookie' });
    const context = await fixture.context.resolve(fixture.userId, undefined, parsedBefore?.contextVersion);
    const switched = await fixture.context.switchTenant({
      actorId: fixture.userId,
      tenantId: fixture.otherTenant.id,
      expectedVersion: context.version,
    });
    const newToken = await fixture.auth.issueTokenForContext(fixture.userId, switched);

    await assert.rejects(
      fixture.auth.parseRequestIdentity(`Bearer ${session.token}`, undefined),
      { errorCode: 'TENANT_CONTEXT_STALE' },
    );
    assert.equal((await fixture.auth.parseRequestIdentity(`Bearer ${newToken}`, undefined))?.tenantId, fixture.otherTenant.id);
    assert.equal((await fixture.auth.parseRequestIdentity(undefined, `gcac_session=${encodeURIComponent(cookie.cookieValue)}`))?.tenantId, fixture.otherTenant.id);
  });

  it('并发切换不会复用错误租户上下文', async () => {
    const fixture = await createFixture('hierarchical');
    await fixture.addMembership(fixture.defaultTenant.id, 'member');
    await fixture.addMembership(fixture.otherTenant.id, 'member');
    const context = await fixture.context.initialize(fixture.userId, fixture.defaultTenant.id);
    const [first, second] = await Promise.all([
      fixture.context.switchTenant({
        actorId: fixture.userId,
        tenantId: fixture.defaultTenant.id,
        expectedVersion: context.version,
      }),
      fixture.context.switchTenant({
        actorId: fixture.userId,
        tenantId: fixture.otherTenant.id,
        expectedVersion: context.version,
      }),
    ]);
    const current = await fixture.context.resolve(fixture.userId);

    assert.equal([first.version, second.version].includes(current.version), true);
    assert.equal([first.currentTenantId, second.currentTenantId].includes(current.currentTenantId), true);
    assert.notEqual(current.version, context.version);
  });

  it('现有 single 模式安全 API 回归通过且 X-Tenant-Id 不会覆盖 Token 租户', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'tenant-context-api-test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    const security = createPersistedSecurityServices(db).services;
    const app = createApp({ db, security, corePersistence: { mode: 'memory' } });
    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: process.env.GCAC_INITIAL_ADMIN_PASSWORD ?? 'admin12345' },
    });
    assert.equal(login.statusCode, 200);
    const token = (login.body as { token: string }).token;

    const me = await app.inject({
      method: 'GET',
      path: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
        'X-Tenant-Id': 'attacker-tenant',
      },
    });
    assert.equal(me.statusCode, 200);
    const defaultTenant = await security.tenantContext!.listAccessibleTenants('user_admin');
    assert.equal((me.body as { user: { tenantId: string } }).user.tenantId, defaultTenant[0]!.tenantId);

    const accessible = await app.inject({
      method: 'GET',
      path: '/api/v1/tenants/accessible',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(accessible.statusCode, 200);
    assert.equal((accessible.body as { mode: string }).mode, 'single');
    assert.equal((accessible.body as { items: unknown[] }).items.length, 1);

    const version = (accessible.body as { version: string }).version;
    const switched = await app.inject({
      method: 'POST',
      path: '/api/v1/tenant-context/switch',
      headers: { authorization: `Bearer ${token}` },
      body: { tenantId: defaultTenant[0]!.tenantId, contextVersion: version },
    });
    assert.equal(switched.statusCode, 200);
    assert.notEqual((switched.body as { version: string }).version, version);

    const stale = await app.inject({
      method: 'GET',
      path: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((stale.body as { errorCode: string }).errorCode, 'TENANT_CONTEXT_STALE');
  });
});

async function createFixture(mode: 'single' | 'hierarchical') {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: `tenant-context-${mode}`,
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const audit = new AuditService();
  const users = new PgDocumentRepository<UserEntity>(db, 'security.users');
  const userId = `user_context_${mode}`;
  await users.upsert({
    id: userId,
    username: userId,
    displayName: userId,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const hierarchy = new TenantHierarchyService(new PgTenantRepository(db), audit);
  const tenants = await hierarchy.listTenants();
  const defaultTenant = tenants.find((tenant) => tenant.code === 'default')!;
  const otherTenant = await hierarchy.createTenant({
    name: `其他租户 ${mode}`,
    code: `other-${mode}`,
    type: 'GROUP',
    actorId: 'user_admin',
  });
  const contextStates = new PgDocumentRepository<TenantContextStateEntity>(db, 'security.tenant_context_states');
  const context = new TenantContextService(
    new TenantIdentityService(db),
    hierarchy,
    contextStates,
    mode,
  );
  return {
    db,
    context,
    hierarchy,
    userId,
    defaultTenant,
    otherTenant,
    addMembership: (
      tenantId: string,
      membershipType: 'owner' | 'admin' | 'operator' | 'auditor' | 'member',
      range: { effectiveFrom?: string; effectiveUntil?: string } = {},
    ) => hierarchy.addMembership({
      subjectType: 'user',
      subjectId: userId,
      tenantId,
      membershipType,
      actorId: 'user_admin',
      ...range,
    }),
  };
}

async function createAuthFixture() {
  const fixture = await createFixture('hierarchical');
  const authUserId = `${fixture.userId}_auth`;
  const users = new PgDocumentRepository<UserEntity>(fixture.db, 'security.users');
  const roles = new PgDocumentRepository<RoleEntity>(fixture.db, 'security.roles');
  const userRoles = new PgDocumentRepository<UserRoleEntity & { id: string }>(fixture.db, 'security.user_roles');
  const policies = new PgDocumentRepository<PermissionPolicyEntity>(fixture.db, 'security.permission_policies');
  const credentials = new PgDocumentRepository<AuthPasswordCredentialEntity>(fixture.db, 'security.auth_password_credentials');
  const sessions = new PgDocumentRepository<AuthBrowserSessionEntity>(fixture.db, 'security.auth_browser_sessions');
  const audit = new AuditService();
  const rbac = new RBACService(users, roles, userRoles, policies, audit);
  const auth = new AuthService(
    rbac,
    credentials,
    audit,
    sessions,
    undefined,
    new TenantIdentityService(fixture.db),
    fixture.context,
  );
  const username = `auth_${authUserId}`;
  await auth.createUserWithPassword({
    id: authUserId,
    username,
    displayName: username,
    password: 'tenant-password',
    status: 'active',
    tenantId: fixture.defaultTenant.id,
  });
  await fixture.hierarchy.addMembership({
    subjectType: 'user',
    subjectId: authUserId,
    tenantId: fixture.defaultTenant.id,
    membershipType: 'member',
    actorId: 'user_admin',
  });
  await fixture.hierarchy.addMembership({
    subjectType: 'user',
    subjectId: authUserId,
    tenantId: fixture.otherTenant.id,
    membershipType: 'member',
    actorId: 'user_admin',
  });
  return { ...fixture, auth, username, userId: authUserId };
}
