import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from './security.controller.js';
import { MockDirectoryConnector, ExternalIdentityService } from './external-identity.service.js';

describe('安全 API 最小闭环', () => {
  it('AD/LDAP 身份源登录会按外部组映射本地角色', async () => {
    const security = createSecurityServices();
    const connector = new MockDirectoryConnector();
    security.externalIdentity = new ExternalIdentityService(security.rbac, security.auth, security.audit, security.secrets, connector);
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
      body: { code: 'ad_ops', name: 'AD 运维组', description: '来自 AD 组映射' },
    });
    const roleId = (role.body as { id: string }).id;
    await app.inject({
      method: 'POST',
      path: '/api/v1/security/permission-policies',
      headers: { authorization: `Bearer ${token}` },
      body: {
        subjectType: 'role',
        subjectId: roleId,
        effect: 'allow',
        actions: ['dashboard.read'],
        resourceTypes: ['dashboard'],
        scope: { tenantId: '*' },
      },
    });

    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: '企业 AD',
        type: 'active_directory',
        url: 'ldaps://ad.example.test:636',
        baseDn: 'DC=example,DC=test',
        userDnTemplate: '{{username}}@example.test',
        groupFilter: '(member={{userDn}})',
        requireGroupMapping: true,
        tlsMode: 'ldaps',
      },
    });
    assert.equal(source.statusCode, 201);
    const sourceId = (source.body as { id: string }).id;

    await app.inject({
      method: 'POST',
      path: '/api/v1/security/group-role-mappings',
      headers: { authorization: `Bearer ${token}` },
      body: { sourceId, externalGroup: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=test', roleId },
    });

    connector.addProfile(sourceId, {
      externalId: 'ad-user-001',
      username: 'alice',
      displayName: 'Alice AD',
      userDn: 'CN=Alice,OU=Users,DC=example,DC=test',
      groups: ['CN=GCAC-Ops,OU=Groups,DC=example,DC=test'],
      password: 'alice-password',
    });

    const createExternalUser = await app.inject({
      method: 'POST',
      path: '/api/v1/security/users/external',
      headers: { authorization: `Bearer ${token}` },
      body: { sourceId, username: 'alice' },
    });
    assert.equal(createExternalUser.statusCode, 201);

    const externalLogin = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'alice', password: 'alice-password' },
    });
    assert.equal(externalLogin.statusCode, 200);
    const session = externalLogin.body as { token: string; user: { username: string; roles: Array<{ code: string }> }; permissions: string[] };
    assert.equal(session.user.username, 'alice');
    assert.deepEqual(session.user.roles.map((item) => item.code), ['ad_ops']);
    assert.equal(session.permissions.includes('dashboard.read'), true);
  });

  it('支持按用户名检索身份源用户并创建绑定用户', async () => {
    const security = createSecurityServices();
    const connector = new MockDirectoryConnector();
    security.externalIdentity = new ExternalIdentityService(security.rbac, security.auth, security.audit, security.secrets, connector);
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
    });
    const token = (login.body as { token: string }).token;

    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: '企业 LDAP',
        type: 'ldap',
        url: 'ldap://ldap.example.test:389',
        baseDn: 'dc=example,dc=test',
        userFilter: '(uid={{username}})',
        requireGroupMapping: false,
        tlsMode: 'none',
      },
    });
    const sourceId = (source.body as { id: string }).id;

    connector.addProfile(sourceId, {
      externalId: 'ldap-user-lookup',
      username: 'lookup-user',
      displayName: 'Lookup User',
      email: 'lookup@example.test',
      userDn: 'uid=lookup-user,ou=people,dc=example,dc=test',
      groups: [],
      password: 'lookup-password',
    });

    const lookup = await app.inject({
      method: 'POST',
      path: '/api/v1/security/users/lookup-external',
      headers: { authorization: `Bearer ${token}` },
      body: { sourceId, username: 'lookup-user' },
    });
    assert.equal(lookup.statusCode, 200);
    const profile = lookup.body as { username: string; displayName: string; email: string; sourceId: string };
    assert.equal(profile.username, 'lookup-user');
    assert.equal(profile.displayName, 'Lookup User');
    assert.equal(profile.email, 'lookup@example.test');
    assert.equal(profile.sourceId, sourceId);

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/security/users/external',
      headers: { authorization: `Bearer ${token}` },
      body: { sourceId, username: 'lookup-user' },
    });
    assert.equal(created.statusCode, 201);
    const createdUser = created.body as { username: string; identityProvider: string; externalSourceId: string; email: string };
    assert.equal(createdUser.username, 'lookup-user');
    assert.equal(createdUser.identityProvider, 'ldap');
    assert.equal(createdUser.externalSourceId, sourceId);
    assert.equal(createdUser.email, 'lookup@example.test');
  });

  it('未由管理员创建的身份源用户不能直接登录控制台', async () => {
    const security = createSecurityServices();
    const connector = new MockDirectoryConnector();
    security.externalIdentity = new ExternalIdentityService(security.rbac, security.auth, security.audit, security.secrets, connector);
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
    });
    const token = (login.body as { token: string }).token;
    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: '企业 LDAP',
        type: 'ldap',
        url: 'ldap://ldap.example.test:389',
        baseDn: 'dc=example,dc=test',
        userFilter: '(uid={{username}})',
        requireGroupMapping: false,
        tlsMode: 'none',
      },
    });
    const sourceId = (source.body as { id: string }).id;
    connector.addProfile(sourceId, {
      externalId: 'ldap-user-not-created',
      username: 'not-created',
      displayName: 'Not Created',
      userDn: 'uid=not-created,ou=people,dc=example,dc=test',
      groups: [],
      password: 'not-created-password',
    });

    const externalLogin = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/external-login',
      body: { sourceId, username: 'not-created', password: 'not-created-password' },
    });
    assert.equal(externalLogin.statusCode, 403);
  });

  it('LDAP 用户同步会写入本地用户列表并带来源字段', async () => {
    const security = createSecurityServices();
    const connector = new MockDirectoryConnector();
    security.externalIdentity = new ExternalIdentityService(security.rbac, security.auth, security.audit, security.secrets, connector);
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
    });
    const token = (login.body as { token: string }).token;

    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: '企业 LDAP',
        type: 'ldap',
        url: 'ldap://ldap.example.test:389',
        baseDn: 'dc=example,dc=test',
        userFilter: '(uid={{username}})',
        syncUserFilter: '(uid={{username}})',
        requireGroupMapping: false,
        tlsMode: 'none',
      },
    });
    const sourceId = (source.body as { id: string }).id;

    connector.addProfile(sourceId, {
      externalId: 'ldap-user-001',
      username: 'bob',
      displayName: 'Bob LDAP',
      email: 'bob@example.test',
      userDn: 'uid=bob,ou=people,dc=example,dc=test',
      groups: [],
      password: 'bob-password',
    });

    const sync = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources/sync-users',
      headers: { authorization: `Bearer ${token}` },
      body: { sourceId },
    });
    assert.equal(sync.statusCode, 200);
    const syncBody = sync.body as { created: number; updated: number; failed: number };
    assert.equal(syncBody.created, 1);
    assert.equal(syncBody.failed, 0);

    const users = await app.inject({
      method: 'GET',
      path: '/api/v1/security/users',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(users.statusCode, 200);
    const items = (users.body as { items: Array<{ username: string; identityProvider: string; externalSourceId?: string; email?: string }> }).items;
    const ldapUser = items.find((item) => item.username === 'bob');
    assert.equal(ldapUser?.identityProvider, 'ldap');
    assert.equal(ldapUser?.externalSourceId, sourceId);
    assert.equal(ldapUser?.email, 'bob@example.test');
  });

  it('AD 同步默认只保留真实用户并使用目录 sAMAccountName 作为本地用户名', async () => {
    const security = createSecurityServices();
    const connector = new MockDirectoryConnector();
    security.externalIdentity = new ExternalIdentityService(security.rbac, security.auth, security.audit, security.secrets, connector);
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
    });
    const token = (login.body as { token: string }).token;

    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: '企业 AD',
        type: 'active_directory',
        url: 'ldaps://ad.example.test:636',
        baseDn: 'DC=example,DC=test',
        userDnTemplate: '{{username}}@example.test',
        groupFilter: '(member={{userDn}})',
        requireGroupMapping: false,
        tlsMode: 'ldaps',
      },
    });
    const sourceId = (source.body as { id: string }).id;

    connector.addProfile(sourceId, {
      externalId: 'ad-user-jackson',
      username: 'jackson',
      displayName: 'Jackson Zhang',
      email: 'jackson@example.test',
      userDn: 'CN=Jackson Zhang,OU=Users,DC=example,DC=test',
      groups: [],
      password: 'jackson-password',
    });

    const sync = await app.inject({
      method: 'POST',
      path: '/api/v1/security/identity-sources/sync-users',
      headers: { authorization: `Bearer ${token}` },
      body: { sourceId },
    });
    assert.equal(sync.statusCode, 200);

    const users = await app.inject({
      method: 'GET',
      path: '/api/v1/security/users',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(users.statusCode, 200);
    const items = (users.body as { items: Array<{ username: string; displayName: string }> }).items;
    const adUser = items.find((item) => item.username === 'jackson');
    assert.equal(adUser?.displayName, 'Jackson Zhang');
  });

  it('支持登录、Bearer Token 当前用户和权限管理 API', async () => {
    const security = createSecurityServices();
    const app = createApp({ security });

    const login = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
      headers: { 'x-request-id': 'req_login' },
    });
    assert.equal(login.statusCode, 200);
    const token = (login.body as { token: string }).token;
    assert.equal(typeof token, 'string');

    const me = await app.inject({
      method: 'GET',
      path: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal((me.body as { user: { username: string } }).user.username, 'admin');

    const users = await app.inject({
      method: 'GET',
      path: '/api/v1/security/users',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(users.statusCode, 200);
    assert.equal((users.body as { items: unknown[] }).items.length >= 1, true);

    const role = await app.inject({
      method: 'POST',
      path: '/api/v1/security/roles',
      headers: { authorization: `Bearer ${token}` },
      body: { code: 'operator', name: '操作员', description: '执行日常证书操作' },
    });
    assert.equal(role.statusCode, 201);
    const roleId = (role.body as { id: string }).id;

    const user = await app.inject({
      method: 'POST',
      path: '/api/v1/security/users',
      headers: { authorization: `Bearer ${token}` },
      body: { username: 'operator', displayName: '操作员', password: 'operator12345', roleId },
    });
    assert.equal(user.statusCode, 201);

    const policy = await app.inject({
      method: 'POST',
      path: '/api/v1/security/permission-policies',
      headers: { authorization: `Bearer ${token}` },
      body: {
        subjectType: 'role',
        subjectId: roleId,
        effect: 'allow',
        actions: ['dashboard.read'],
        resourceTypes: ['dashboard'],
        scope: { tenantId: '*' },
      },
    });
    assert.equal(policy.statusCode, 201);
  });

  it('错误密码不能登录，禁用用户不能继续登录', async () => {
    const security = createSecurityServices();
    const app = createApp({ security });

    const failed = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'wrong-password' },
    });
    assert.equal(failed.statusCode, 401);

    await security.rbac.updateUserStatus('user_admin', 'disabled');
    const disabled = await app.inject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'admin', password: 'admin12345' },
    });
    assert.equal(disabled.statusCode, 403);
  });
  it('审计查询默认按创建时间从新到旧排序并支持分页', async () => {
    const security = createSecurityServices();
    await security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_audit_sort',
      effect: 'allow',
      actions: ['audit.read'],
      resourceTypes: ['audit_sort_probe'],
      scope: { tenantId: 'tenant_1' },
    });
    await security.audit.write({
      eventType: 'auth.login.success',
      actorType: 'user',
      actorId: 'user_old',
      action: 'auth.login',
      resourceType: 'audit_sort_probe',
      result: 'success',
      riskLevel: 'low',
      context: { requestId: 'req_old' },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await security.audit.write({
      eventType: 'secret.created',
      actorType: 'user',
      actorId: 'user_new',
      action: 'secret.create',
      resourceType: 'audit_sort_probe',
      result: 'success',
      riskLevel: 'high',
      context: { requestId: 'req_new' },
    });

    const app = createApp({ security });
    const response = await app.inject({
      method: 'GET',
      path: '/api/v1/audit-events?resourceType=audit_sort_probe&page=1&pageSize=1',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_audit_sort' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body as { items: Array<{ actorId: string }>; page: number; pageSize: number; total: number };
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 1);
    assert.equal(body.total, 2);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.actorId, 'user_new');
  });

  it('Secret 创建只返回元数据和 SecretRef，并写入审计', async () => {
    const security = createSecurityServices();
    await security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_secret',
      effect: 'allow',
      actions: ['secret.create', 'secret.read', 'audit.read'],
      resourceTypes: ['secret'],
      scope: { tenantId: 'tenant_1' },
    });
    const app = createApp({ security });

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret', 'x-request-id': 'req_secret_api' },
      body: {
        name: '生产 SSH Key',
        type: 'ssh_key',
        scopeType: 'team',
        scopeId: 'team_ops',
        plainText: 'super-secret-private-key',
      },
    });

    assert.equal(created.statusCode, 201);
    const secret = created.body as { id: string; secretRef: string; plainText?: string };
    assert.equal(secret.secretRef.startsWith('secret://ssh_key/'), true);
    assert.equal(secret.plainText, undefined);

    const metadata = await app.inject({
      method: 'GET',
      path: `/api/v1/secrets/metadata?id=${secret.id}`,
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret' },
    });
    assert.equal(metadata.statusCode, 200);
    assert.equal((metadata.body as { id: string }).id, secret.id);

    const audits = await app.inject({
      method: 'GET',
      path: '/api/v1/audit-events?resourceType=secret&eventType=secret.created',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret' },
    });
    assert.equal(audits.statusCode, 200);
    assert.equal((audits.body as { items: unknown[] }).items.length, 1);
  });

  it('Secret 创建只接受后端支持的存储类型，用户名密码统一使用 password', async () => {
    const security = createSecurityServices();
    await security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_secret_type',
      effect: 'allow',
      actions: ['secret.create'],
      resourceTypes: ['secret'],
      scope: { tenantId: 'tenant_1' },
    });
    const app = createApp({ security });

    const password = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret_type' },
      body: {
        name: '设备登录密码',
        type: 'password',
        scopeType: 'global',
        plainText: 'secret-password',
      },
    });
    assert.equal(password.statusCode, 201);
    assert.match((password.body as { secretRef: string }).secretRef, /^secret:\/\/password\/sec_/);

    for (const type of ['ssh_password', 'curl_basic']) {
      const invalid = await app.inject({
        method: 'POST',
        path: '/api/v1/secrets',
        headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret_type' },
        body: {
          name: '无效凭据类型',
          type,
          scopeType: 'global',
          plainText: 'secret-password',
        },
      });
      assert.equal(invalid.statusCode, 400);
    }
  });

  it('审批 API 支持创建和他人审批，且无权限审计查询会被拒绝', async () => {
    const security = createSecurityServices();
    await security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'requester',
      effect: 'allow',
      actions: ['approval.create'],
      resourceTypes: ['approval'],
      scope: { tenantId: 'tenant_1' },
    });
    await security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'approver',
      effect: 'allow',
      actions: ['approval.decide'],
      resourceTypes: ['approval'],
      scope: { tenantId: 'tenant_1' },
    });
    const app = createApp({ security });

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/approvals',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'requester' },
      body: {
        operationType: 'deployment.execute',
        resourceRefs: [{ type: 'execution', id: 'run_1' }],
        riskLevel: 'high',
        parameters: { runId: 'run_1', stepId: 'step_1' },
      },
    });
    assert.equal(created.statusCode, 201);
    const approvalId = (created.body as { id: string }).id;

    const decided = await app.inject({
      method: 'POST',
      path: '/api/v1/approvals/decide',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'approver' },
      body: { approvalId, decision: 'approved', comment: '同意执行' },
    });
    assert.equal(decided.statusCode, 200);
    assert.equal((decided.body as { status: string }).status, 'approved');

    const deniedAudit = await app.inject({
      method: 'GET',
      path: '/api/v1/audit-events?resourceType=approval',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'requester' },
    });
    assert.equal(deniedAudit.statusCode, 403);
    assert.equal((deniedAudit.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
  });
});
