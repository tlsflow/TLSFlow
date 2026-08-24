import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { RBACService } from '../rbac/rbac.service.js';
import { AuditService } from '../audits/audit.service.js';
import { AuthService } from './auth.service.js';
import { ExternalIdentityService, MockDirectoryConnector, type ExternalGroupRoleMapping, type IdentitySource } from './external-identity.service.js';
import type { AuthPasswordCredentialEntity } from '../../persistence/entities/auth-credential.entity.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';

describe('ExternalIdentityService 持久化', () => {
  it('身份源和组映射写入 PG 后，重建服务仍可使用', async () => {
    const db = new PgliteDatabase();
    const users = new PgDocumentRepository<UserEntity>(db, 'security.users');
    const roles = new PgDocumentRepository<RoleEntity>(db, 'security.roles');
    const userRoles = new PgDocumentRepository<UserRoleEntity & { id: string }>(db, 'security.user_roles');
    const policies = new PgDocumentRepository<PermissionPolicyEntity>(db, 'security.permission_policies');
    const credentials = new PgDocumentRepository<AuthPasswordCredentialEntity>(db, 'security.auth_password_credentials');
    const sources = new PgDocumentRepository<IdentitySource>(db, 'security.identity_sources');
    const mappings = new PgDocumentRepository<ExternalGroupRoleMapping>(db, 'security.external_group_role_mappings');

    const audit = new AuditService();
    const rbac = new RBACService(users, roles, userRoles, policies, audit);
    const auth = new AuthService(rbac, credentials, audit);
    const first = new ExternalIdentityService(rbac, auth, audit, undefined, new MockDirectoryConnector(), sources, mappings);

    await rbac.createRole({ id: 'role_ad_ops', code: 'ad_ops', name: 'AD Ops', builtin: false });
    const source = await first.createSource({
      name: '企业 AD',
      type: 'active_directory',
      enabled: true,
      url: 'ldaps://ad.example.test:636',
      baseDn: 'DC=example,DC=test',
      userDnTemplate: '{{username}}@example.test',
      groupFilter: '(member={{userDn}})',
      requireGroupMapping: true,
      tlsMode: 'ldaps',
    }, { id: 'user_admin', type: 'user' }, { requestId: 'req_identity_persist', sourceIp: '127.0.0.1' });
    await first.createMapping({ sourceId: source.id, externalGroup: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=test', roleId: 'role_ad_ops', enabled: true }, { id: 'user_admin', type: 'user' }, { requestId: 'req_identity_persist', sourceIp: '127.0.0.1' });

    const rebuilt = new ExternalIdentityService(rbac, auth, audit, undefined, new MockDirectoryConnector(), sources, mappings);
    const publicSources = await rebuilt.listPublicSources();
    const savedMappings = await rebuilt.listMappings();

    assert.equal(publicSources.length, 1);
    assert.equal(publicSources[0].id, source.id);
    assert.equal(savedMappings.length, 1);
    assert.equal(savedMappings[0].sourceId, source.id);
  });
});
