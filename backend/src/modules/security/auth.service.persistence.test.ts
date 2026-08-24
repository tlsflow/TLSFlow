import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { AuthPasswordCredentialEntity } from '../../persistence/entities/auth-credential.entity.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import { RBACService } from '../rbac/rbac.service.js';
import { AuditService } from '../audits/audit.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService 持久化', () => {
  it('用户密码凭据写入 PG 后，重建服务仍可登录', async () => {
    const db = new PgliteDatabase();
    const users = new PgDocumentRepository<UserEntity>(db, 'security.users');
    const roles = new PgDocumentRepository<RoleEntity>(db, 'security.roles');
    const userRoles = new PgDocumentRepository<UserRoleEntity & { id: string }>(db, 'security.user_roles');
    const policies = new PgDocumentRepository<PermissionPolicyEntity>(db, 'security.permission_policies');
    const credentials = new PgDocumentRepository<AuthPasswordCredentialEntity>(db, 'security.auth_password_credentials');

    const audit = new AuditService();
    const rbac = new RBACService(users, roles, userRoles, policies, audit);
    const first = new AuthService(rbac, credentials, audit);

    await first.createUserWithPassword({
      id: 'user_operator_persist',
      username: 'operator-persist',
      displayName: 'Operator Persist',
      password: 'operator12345',
      status: 'active',
      tenantId: 'default',
      tenantName: 'Default',
    });

    const rebuilt = new AuthService(new RBACService(users, roles, userRoles, policies, audit), credentials, audit);
    const session = await rebuilt.login(
      { username: 'operator-persist', password: 'operator12345' },
      { requestId: 'req_auth_persist', traceId: 'trace_auth_persist', tenantId: 'default' },
    );

    assert.equal(session.user.username, 'operator-persist');
    assert.equal(typeof session.token, 'string');
    assert.equal((await credentials.get('user_operator_persist'))?.userId, 'user_operator_persist');
  });

  it('登录和请求身份解析统一使用租户 UUID', async () => {
    const db = new PgliteDatabase();
    const users = new PgDocumentRepository<UserEntity>(db, 'security.users');
    const roles = new PgDocumentRepository<RoleEntity>(db, 'security.roles');
    const userRoles = new PgDocumentRepository<UserRoleEntity & { id: string }>(db, 'security.user_roles');
    const policies = new PgDocumentRepository<PermissionPolicyEntity>(db, 'security.permission_policies');
    const credentials = new PgDocumentRepository<AuthPasswordCredentialEntity>(db, 'security.auth_password_credentials');
    const audit = new AuditService();
    const rbac = new RBACService(users, roles, userRoles, policies, audit);
    const resolver = {
      resolve: async (identifier: string) => identifier === 'default' ? '00000000-0000-4000-8000-000000000001' : identifier,
      resolveDefault: async () => '00000000-0000-4000-8000-000000000001',
    };
    const auth = new AuthService(rbac, credentials, audit, undefined, undefined, resolver);

    await auth.createUserWithPassword({
      id: 'user_tenant_uuid',
      username: 'tenant-uuid',
      displayName: 'Tenant UUID',
      password: 'tenant12345',
      status: 'active',
      tenantId: 'default',
      tenantName: 'Default',
    });

    const session = await auth.login(
      { username: 'tenant-uuid', password: 'tenant12345' },
      { requestId: 'req_tenant_uuid', traceId: 'trace_tenant_uuid' },
    );
    assert.equal(session.user.tenantId, '00000000-0000-4000-8000-000000000001');
    assert.equal(
      (await auth.parseRequestIdentity(`Bearer ${session.token}`, undefined))?.tenantId,
      '00000000-0000-4000-8000-000000000001',
    );
  });
});
