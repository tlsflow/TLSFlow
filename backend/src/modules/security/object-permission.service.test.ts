import test from 'node:test';
import assert from 'node:assert/strict';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { PermissionPolicyEntity, RoleEntity, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import type {
  AccessGrantEntity,
  GroupEntity,
  GroupMemberEntity,
  ObjectSetEntity,
  ObjectSetMemberEntity,
  ObjectTypeEntity,
  RoleBindingEntity,
} from '../../persistence/entities/object-permission.entity.js';
import { ObjectPermissionService } from './object-permission.service.js';
import { AuditService } from '../audits/audit.service.js';
import { applyAuthorizationFilter } from '../../common/pagination/pagination.js';

test('对象级权限支持静态集合、三档权限和 deny 优先', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_ops', code: 'ops', name: '运维', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_cert_a',
    tenantId: 'tenant_a',
    name: '证书 A 集合',
    kind: 'static',
    objectTypes: ['certificate'],
    status: 'active',
  });
  await service.addObjectSetMember({
    objectSetId: objectSet.id,
    objectType: 'certificate',
    objectId: 'cert_a',
    addedBy: 'user_admin',
  });
  await service.createRoleBinding({
    tenantId: 'tenant_a',
    principalType: 'user',
    principalId: 'user_ops',
    roleId: 'role_ops',
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await service.createAccessGrant({
    roleId: 'role_ops',
    objectSetId: objectSet.id,
    accessLevel: 'edit',
    effect: 'allow',
  });

  const subject = { id: 'user_ops', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
  assert.equal((await service.can(subject, 'read', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, true);
  assert.equal((await service.can(subject, 'edit', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, true);
  assert.equal((await service.can(subject, 'control', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, false);
  assert.equal((await service.can(subject, 'read', { objectType: 'certificate', objectId: 'cert_b', tenantId: 'tenant_a' })).allowed, false);

  await service.createAccessGrant({
    roleId: 'role_ops',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'deny',
  });
  const denied = await service.can(subject, 'read', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'explicit deny');
});

test('对象级权限兼容管理员通配权限', async () => {
  const { service, policies } = createServiceWithRepos();
  await policies.create({
    id: 'policy_admin_all',
    subjectType: 'role',
    subjectId: 'role_admin',
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: {},
  });
  const result = await service.can(
    { id: 'user_admin', type: 'user', roleIds: ['role_admin'], scope: { tenantId: 'tenant_a' } },
    'control',
    { objectType: 'gateway', objectId: 'gw_a', tenantId: 'tenant_a' },
  );
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'admin wildcard');
});

test('列表授权查询支持静态成员、动态条件和 deny 优先', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_asset_reader', code: 'asset_reader', name: '资产只读', builtin: false });
  await service.ensureDefaultObjectTypes();
  const staticSet = await service.createObjectSet({
    id: 'oset_static_assets',
    tenantId: 'tenant_a',
    name: '静态应用资产',
    kind: 'static',
    objectTypes: ['service_asset'],
    status: 'active',
  });
  const dynamicSet = await service.createObjectSet({
    id: 'oset_prod_assets',
    tenantId: 'tenant_a',
    name: '生产应用资产',
    kind: 'dynamic',
    objectTypes: ['service_asset'],
    conditions: { environment: 'prod' },
    status: 'active',
  });
  const denySet = await service.createObjectSet({
    id: 'oset_denied_assets',
    tenantId: 'tenant_a',
    name: '拒绝应用资产',
    kind: 'static',
    objectTypes: ['service_asset'],
    status: 'active',
  });
  await service.addObjectSetMember({ objectSetId: staticSet.id, objectType: 'service_asset', objectId: 'asset_static', addedBy: 'admin' });
  await service.addObjectSetMember({ objectSetId: denySet.id, objectType: 'service_asset', objectId: 'asset_denied', addedBy: 'admin' });
  for (const objectSetId of [staticSet.id, dynamicSet.id, denySet.id]) {
    await service.createRoleBinding({
      tenantId: 'tenant_a',
      principalType: 'user',
      principalId: 'user_reader',
      roleId: 'role_asset_reader',
      objectSetId,
      effect: 'allow',
      enabled: true,
    });
  }
  await service.createAccessGrant({ roleId: 'role_asset_reader', objectSetId: staticSet.id, accessLevel: 'read', effect: 'allow' });
  await service.createAccessGrant({ roleId: 'role_asset_reader', objectSetId: dynamicSet.id, accessLevel: 'read', effect: 'allow' });
  await service.createAccessGrant({ roleId: 'role_asset_reader', objectSetId: denySet.id, accessLevel: 'read', effect: 'deny' });

  const authorization = await service.buildAuthorizedQuery(
    { id: 'user_reader', type: 'user' as const, scope: { tenantId: 'tenant_a' } },
    'service_asset',
    'read',
  );
  const items = applyAuthorizationFilter([
    { id: 'asset_static', environment: 'dev' },
    { id: 'asset_dynamic', environment: 'prod' },
    { id: 'asset_denied', environment: 'prod' },
    { id: 'asset_other', environment: 'dev' },
  ], { page: 1, pageSize: 20, filter: {}, authorization });

  assert.deepEqual(items.map((item) => item.id), ['asset_static', 'asset_dynamic']);

  const targets = applyAuthorizationFilter([
    { id: 'target_a', applicationAssetId: 'asset_static', environment: 'dev' },
    { id: 'target_b', applicationAssetId: 'asset_other', environment: 'dev' },
  ], { page: 1, pageSize: 20, filter: {}, authorization: { ...authorization, objectIdField: 'applicationAssetId' } });
  assert.deepEqual(targets.map((item) => item.id), ['target_a']);
});

function createService(): ObjectPermissionService {
  return createServiceWithRepos().service;
}

function createServiceWithRepos(): { service: ObjectPermissionService; policies: PgDocumentRepository<PermissionPolicyEntity>; roles: PgDocumentRepository<RoleEntity> } {
  const db = new PgliteDatabase();
  const groups = new PgDocumentRepository<GroupEntity>(db, 'test.groups');
  const groupMembers = new PgDocumentRepository<GroupMemberEntity>(db, 'test.group_members');
  const roleBindings = new PgDocumentRepository<RoleBindingEntity>(db, 'test.role_bindings');
  const objectTypes = new PgDocumentRepository<ObjectTypeEntity>(db, 'test.object_types');
  const objectSets = new PgDocumentRepository<ObjectSetEntity>(db, 'test.object_sets');
  const objectSetMembers = new PgDocumentRepository<ObjectSetMemberEntity>(db, 'test.object_set_members');
  const accessGrants = new PgDocumentRepository<AccessGrantEntity>(db, 'test.access_grants');
  const userRoles = new PgDocumentRepository<UserRoleEntity & { id: string }>(db, 'test.user_roles');
  const policies = new PgDocumentRepository<PermissionPolicyEntity>(db, 'test.permission_policies');
  const roles = new PgDocumentRepository<RoleEntity>(db, 'test.roles');
  return {
    service: new ObjectPermissionService(groups, groupMembers, roleBindings, objectTypes, objectSets, objectSetMembers, accessGrants, userRoles, policies, roles, new AuditService()),
    policies,
    roles,
  };
}
