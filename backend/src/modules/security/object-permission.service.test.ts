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
    tenantId: 'tenant_a',
    roleId: 'role_ops',
    objectSetId: objectSet.id,
    accessLevel: 'edit',
    effect: 'allow',
  });

  const subject = { id: 'user_ops', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
  assert.equal((await service.can(subject, 'read', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, true);
  assert.equal((await service.can(subject, 'read', { objectType: 'certificate_asset', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, true);
  assert.equal((await service.can(subject, 'edit', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, true);
  assert.equal((await service.can(subject, 'control', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, false);
  assert.equal((await service.can(subject, 'read', { objectType: 'certificate', objectId: 'cert_b', tenantId: 'tenant_a' })).allowed, false);
  const certificateAssetQuery = await service.buildAuthorizedQuery(subject, 'certificate_asset', 'read');
  assert.deepEqual(certificateAssetQuery.objectIds, ['cert_a']);

  await service.createAccessGrant({
    tenantId: 'tenant_a',
    roleId: 'role_ops',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'deny',
  });
  const denied = await service.can(subject, 'read', { objectType: 'certificate', objectId: 'cert_a', tenantId: 'tenant_a' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'explicit deny');
});

test('旧版用户角色在没有显式对象绑定时也能继承角色对象授权', async () => {
  const { service, roles, userRoles } = createServiceWithRepos();
  await roles.create({ id: 'role_cert_reader', code: 'cert_reader', name: '证书只读', builtin: false });
  await userRoles.create({
    id: 'user_reader:role_cert_reader',
    userId: 'user_reader',
    roleId: 'role_cert_reader',
    createdAt: '2026-08-07T00:00:00.000Z',
  });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_cert_reader',
    tenantId: 'tenant_a',
    name: 'tenant a 证书',
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
  await service.createAccessGrant({
    tenantId: 'tenant_a',
    roleId: 'role_cert_reader',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'allow',
  });

  const subject = { id: 'user_reader', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
  assert.equal((await service.can(subject, 'read', { objectType: 'certificate_asset', objectId: 'cert_a', tenantId: 'tenant_a' })).allowed, true);
  const authorization = await service.buildAuthorizedQuery(subject, 'certificate_asset', 'read');
  assert.deepEqual(authorization.objectIds, ['cert_a']);
});

test('角色绑定把成员解析为业务授权角色主体，deny 绑定不能成为授权来源', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_business_manager', code: 'business_manager', name: '应用管理者', builtin: false });
  await roles.create({ id: 'role_denied_only', code: 'denied_only', name: '拒绝角色', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_business_application',
    tenantId: 'tenant_a',
    name: '应用业务范围',
    kind: 'static',
    objectTypes: ['service_asset'],
    status: 'active',
  });
  await service.createRoleBinding({
    tenantId: 'tenant_a',
    principalType: 'user',
    principalId: 'user_operator',
    roleId: 'role_business_manager',
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await service.createRoleBinding({
    tenantId: 'tenant_a',
    principalType: 'user',
    principalId: 'user_operator',
    roleId: 'role_denied_only',
    objectSetId: objectSet.id,
    effect: 'deny',
    enabled: true,
  });

  const principals = await service.resolvePrincipals({
    id: 'user_operator',
    type: 'user',
    scope: { tenantId: 'tenant_a' },
  });

  assert.equal(principals.some((item) => item.type === 'group' && item.id === 'role_business_manager' && item.source === 'role-binding'), true);
  assert.equal(principals.some((item) => item.type === 'group' && item.id === 'role_denied_only' && item.source === 'role-binding'), false);
});

test('对象级权限兼容管理员通配权限，但租户边界始终优先', async () => {
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

  const constrained = await service.can(
    {
      id: 'user_admin',
      type: 'user',
      roleIds: ['role_admin'],
      scope: {
        tenantId: 'tenant_a',
        tenantScope: { type: 'SELF', rootTenantId: 'tenant_a', tenantIds: ['tenant_a'] },
      },
    },
    'control',
    { objectType: 'gateway', objectId: 'gw_b', tenantId: 'tenant_b' },
  );
  assert.equal(constrained.allowed, false);
  assert.equal(constrained.reason, 'tenant scope denied');

  const authorization = await service.buildAuthorizedQuery(
    {
      id: 'user_admin',
      type: 'user',
      roleIds: ['role_admin'],
      scope: {
        tenantId: 'tenant_a',
        tenantScope: { type: 'SELF', rootTenantId: 'tenant_a', tenantIds: ['tenant_a'] },
      },
    },
    'workflow',
    'read',
  );
  assert.equal(authorization.unrestricted, true);
  assert.deepEqual(authorization.tenantIds, ['tenant_a']);
});

test('内置对象集合支持在升级后回填新增对象类型', async () => {
  const service = createService();
  await service.ensureDefaultObjectTypes();
  await service.createObjectSet({
    id: 'oset_builtin_admin_all',
    tenantId: '*',
    name: '系统管理员全部业务对象',
    kind: 'dynamic',
    objectTypes: ['certificate'],
    conditions: {},
    status: 'active',
  });

  const synced = await service.syncObjectSetObjectTypes('oset_builtin_admin_all', ['certificate', 'workflow_execution_binding', 'approval']);
  assert.equal(synced?.objectTypes.includes('certificate'), true);
  assert.equal(synced?.objectTypes.includes('workflow_execution_binding'), true);
  assert.equal(synced?.objectTypes.includes('approval'), true);
});

test('结构化租户范围约束旧通配绑定和列表授权', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_group_reader', code: 'group_reader', name: '集团只读', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_group_hosts',
    tenantId: '*',
    name: '集团主机集合',
    kind: 'static',
    objectTypes: ['host'],
    status: 'active',
  });
  await service.addObjectSetMember({ objectSetId: objectSet.id, objectType: 'host', objectId: 'host_a', tenantId: 'company_a', addedBy: 'admin' });
  await service.addObjectSetMember({ objectSetId: objectSet.id, objectType: 'host', objectId: 'host_b', tenantId: 'company_b', addedBy: 'admin' });
  await service.createRoleBinding({
    tenantId: '*',
    principalType: 'user',
    principalId: 'user_group_reader',
    roleId: 'role_group_reader',
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await service.createAccessGrant({
    tenantId: '*',
    roleId: 'role_group_reader',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'allow',
  });

  const subject = {
    id: 'user_group_reader',
    type: 'user' as const,
    scope: {
      tenantId: 'group_a',
      tenantScope: {
        type: 'SUBTREE' as const,
        rootTenantId: 'group_a',
        tenantIds: ['group_a', 'company_a'],
      },
    },
  };
  assert.equal((await service.can(subject, 'read', { objectType: 'host', objectId: 'host_a', tenantId: 'company_a' })).allowed, true);
  const sibling = await service.can(subject, 'read', { objectType: 'host', objectId: 'host_b', tenantId: 'company_b' });
  assert.equal(sibling.allowed, false);
  assert.equal(sibling.reason, 'tenant scope denied');

  const authorization = await service.buildAuthorizedQuery(subject, 'host', 'read');
  assert.deepEqual(authorization.tenantIds, ['group_a', 'company_a']);
  assert.deepEqual(authorization.ownerTypes, ['TENANT']);
  const items = applyAuthorizationFilter([
    { id: 'host_a', tenantId: 'company_a' },
    { id: 'host_b', tenantId: 'company_b' },
  ], { page: 1, pageSize: 20, filter: {}, authorization });
  assert.deepEqual(items.map((item) => item.id), ['host_a']);
});

test('SYSTEM 范围只允许系统所有权对象', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_system_reader', code: 'system_reader', name: '系统资源只读', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_system_settings',
    tenantId: '*',
    name: '系统设置集合',
    kind: 'static',
    objectTypes: ['system_setting'],
    status: 'active',
  });
  await service.addObjectSetMember({
    objectSetId: objectSet.id,
    objectType: 'system_setting',
    objectId: 'setting_builtin',
    addedBy: 'system',
  });
  await service.createRoleBinding({
    tenantId: '*',
    principalType: 'user',
    principalId: 'user_system_reader',
    roleId: 'role_system_reader',
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await service.createAccessGrant({
    tenantId: '*',
    roleId: 'role_system_reader',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'allow',
  });

  const subject = {
    id: 'user_system_reader',
    type: 'user' as const,
    scope: { tenantScope: { type: 'SYSTEM' as const } },
  };
  assert.equal((await service.can(subject, 'read', {
    objectType: 'system_setting',
    objectId: 'setting_builtin',
    ownerType: 'SYSTEM',
  })).allowed, true);
  assert.equal((await service.can(subject, 'read', {
    objectType: 'system_setting',
    objectId: 'setting_builtin',
    tenantId: 'tenant_a',
  })).allowed, false);
});

test('租户范围内可通过对象集合授权访问共享 SYSTEM 对象，但不会放开其他 SYSTEM 对象', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_builtin_plugin_reader', code: 'builtin_plugin_reader', name: '内置插件只读', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_builtin_plugins',
    tenantId: '*',
    name: '共享内置插件',
    kind: 'static',
    objectTypes: ['plugin_version'],
    status: 'active',
  });
  await service.addObjectSetMember({
    objectSetId: objectSet.id,
    objectType: 'plugin_version',
    objectId: 'plugin_builtin_v1',
    addedBy: 'system',
  });
  await service.createRoleBinding({
    tenantId: '*',
    principalType: 'user',
    principalId: 'user_tenant_reader',
    roleId: 'role_builtin_plugin_reader',
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await service.createAccessGrant({
    tenantId: '*',
    roleId: 'role_builtin_plugin_reader',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'allow',
  });

  const subject = {
    id: 'user_tenant_reader',
    type: 'user' as const,
    scope: {
      tenantId: 'group_a',
      tenantScope: {
        type: 'SUBTREE' as const,
        rootTenantId: 'group_a',
        tenantIds: ['group_a', 'company_a'],
      },
    },
  };

  assert.equal((await service.can(subject, 'read', {
    objectType: 'plugin_version',
    objectId: 'plugin_builtin_v1',
    ownerType: 'SYSTEM',
  })).allowed, true);
  assert.equal((await service.can(subject, 'read', {
    objectType: 'plugin_version',
    objectId: 'plugin_builtin_v2',
    ownerType: 'SYSTEM',
  })).allowed, false);

  const authorization = await service.buildAuthorizedQuery(subject, 'plugin_version', 'read');
  assert.deepEqual(authorization.ownerTypes, ['TENANT', 'SYSTEM']);
  const items = applyAuthorizationFilter([
    { id: 'plugin_builtin_v1', ownerType: 'SYSTEM' },
    { id: 'plugin_builtin_v2', ownerType: 'SYSTEM' },
    { id: 'plugin_tenant_v1', tenantId: 'company_a' },
  ], { page: 1, pageSize: 20, filter: {}, authorization });
  assert.deepEqual(items.map((item) => item.id), ['plugin_builtin_v1']);
});

test('静态对象集合成员必须与真实租户一致，不能把同一对象 ID 扩散到其他租户', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_group_asset_reader', code: 'group_asset_reader', name: '集团资产只读', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_group_assets',
    tenantId: '*',
    name: '集团应用资产集合',
    kind: 'static',
    objectTypes: ['service_asset'],
    status: 'active',
  });
  const member = await service.addObjectSetMember({
    objectSetId: objectSet.id,
    objectType: 'service_asset',
    objectId: 'asset_shared_id',
    tenantId: 'company_a',
    addedBy: 'admin',
  });
  assert.equal(member.tenantId, 'company_a');
  await service.createRoleBinding({
    tenantId: '*',
    principalType: 'user',
    principalId: 'user_group_asset_reader',
    roleId: 'role_group_asset_reader',
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await service.createAccessGrant({
    tenantId: '*',
    roleId: 'role_group_asset_reader',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'allow',
  });

  const subject = {
    id: 'user_group_asset_reader',
    type: 'user' as const,
    scope: {
      tenantId: 'group_a',
      tenantScope: {
        type: 'SUBTREE' as const,
        rootTenantId: 'group_a',
        tenantIds: ['group_a', 'company_a', 'company_b'],
      },
    },
  };
  assert.equal((await service.can(subject, 'read', {
    objectType: 'service_asset',
    objectId: 'asset_shared_id',
    tenantId: 'company_a',
  })).allowed, true);
  const crossTenant = await service.can(subject, 'read', {
    objectType: 'service_asset',
    objectId: 'asset_shared_id',
    tenantId: 'company_b',
  });
  assert.equal(crossTenant.allowed, false);
});

test('默认对象目录覆盖阶段 3 的授权根对象与派生对象', async () => {
  const { service } = createServiceWithRepos();
  const types = await service.listObjectTypes();
  const typeCodes = new Set(types.map((item) => item.code));
  const executionStep = types.find((item) => item.code === 'execution_step');
  const certificateVersion = types.find((item) => item.code === 'certificate_version');
  const certificateRequest = types.find((item) => item.code === 'certificate_request');
  const certificateRenewal = types.find((item) => item.code === 'certificate_renewal');
  const workflowTemplate = types.find((item) => item.code === 'workflow_template');
  const secret = types.find((item) => item.code === 'secret');
  assert.deepEqual(executionStep?.parentTypes, ['execution_run']);
  assert.deepEqual(certificateVersion?.parentTypes, ['certificate', 'certificate_asset']);
  assert.deepEqual(certificateRequest?.parentTypes, ['certificate_authority']);
  assert.deepEqual(certificateRenewal?.parentTypes, ['certificate_asset', 'certificate_authority']);
  for (const retiredType of ['acme_account', 'ca_provider', 'ca_node', 'cloud_account_asset', 'provider_operation']) {
    assert.equal(typeCodes.has(retiredType), false, `不应注册已删除的厂商对象类型：${retiredType}`);
  }
  assert.equal(workflowTemplate?.tableName, 'workflow_templates');
  assert.equal(secret?.tenantField, 'tenant_id');
});

test('AccessGrant 创建必须匹配对象集合租户边界', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_access_guard', code: 'access_guard', name: '授权守卫', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_tenant_a_only',
    tenantId: 'tenant_a',
    name: 'tenant a only',
    kind: 'static',
    objectTypes: ['secret'],
    status: 'active',
  });

  await assert.rejects(
    () => service.createAccessGrant({
      tenantId: 'tenant_b',
      roleId: 'role_access_guard',
      objectSetId: objectSet.id,
      accessLevel: 'read',
      effect: 'allow',
    }),
    (error: any) => error.errorCode === 'SEC_PERMISSION_DENIED',
  );
});

test('历史全局对象集合只允许系统租户继续引用', async () => {
  const { service, roles } = createServiceWithRepos();
  await roles.create({ id: 'role_global_guard', code: 'global_guard', name: '全局集合守卫', builtin: false });
  await service.ensureDefaultObjectTypes();
  const objectSet = await service.createObjectSet({
    id: 'oset_legacy_global',
    tenantId: '*',
    name: 'legacy global',
    kind: 'static',
    objectTypes: ['secret'],
    status: 'active',
  });

  await assert.rejects(
    () => service.createRoleBinding({
      tenantId: 'tenant_a',
      principalType: 'user',
      principalId: 'user_a',
      roleId: 'role_global_guard',
      objectSetId: objectSet.id,
      effect: 'allow',
      enabled: true,
    }),
    (error: any) => error.errorCode === 'SEC_PERMISSION_DENIED',
  );

  await assert.rejects(
    () => service.createAccessGrant({
      tenantId: 'tenant_a',
      roleId: 'role_global_guard',
      objectSetId: objectSet.id,
      accessLevel: 'read',
      effect: 'allow',
    }),
    (error: any) => error.errorCode === 'SEC_PERMISSION_DENIED',
  );

  await service.createRoleBinding({
    tenantId: '*',
    principalType: 'user',
    principalId: 'user_system',
    roleId: 'role_global_guard',
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await service.createAccessGrant({
    tenantId: '*',
    roleId: 'role_global_guard',
    objectSetId: objectSet.id,
    accessLevel: 'read',
    effect: 'allow',
  });
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
  await service.createAccessGrant({ tenantId: 'tenant_a', roleId: 'role_asset_reader', objectSetId: staticSet.id, accessLevel: 'read', effect: 'allow' });
  await service.createAccessGrant({ tenantId: 'tenant_a', roleId: 'role_asset_reader', objectSetId: dynamicSet.id, accessLevel: 'read', effect: 'allow' });
  await service.createAccessGrant({ tenantId: 'tenant_a', roleId: 'role_asset_reader', objectSetId: denySet.id, accessLevel: 'read', effect: 'deny' });

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

function createServiceWithRepos(): {
  service: ObjectPermissionService;
  policies: PgDocumentRepository<PermissionPolicyEntity>;
  roles: PgDocumentRepository<RoleEntity>;
  userRoles: PgDocumentRepository<UserRoleEntity & { id: string }>;
} {
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
    userRoles,
  };
}
