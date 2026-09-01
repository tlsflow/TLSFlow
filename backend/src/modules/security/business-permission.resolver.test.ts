import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { BusinessPermissionGrantEntity, BusinessPermissionRelationEntity } from '../../persistence/entities/business-permission.entity.js';
import { BUSINESS_PERMISSION_DOMAINS, BUSINESS_PERMISSION_LEVELS } from '../../persistence/entities/business-permission.entity.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { BusinessPermissionResolver } from './business-permission.resolver.js';
import { BUSINESS_PERMISSION_ACTION_ALIASES, BUSINESS_PERMISSION_PRESETS } from './business-permission.registry.js';
import type { SecuritySubject } from '../../shared/security-types.js';

function createResolver(
  rootExists?: (input: { tenantId: string; objectType: string; objectId: string }) => Promise<boolean>,
  isTenantAdministrator?: (input: { subject: SecuritySubject; tenantId: string }) => Promise<boolean>,
) {
  const db = new PgliteDatabase();
  const grants = new PgDocumentRepository<BusinessPermissionGrantEntity>(db, 'test.business_permission_grants');
  const relations = new PgDocumentRepository<BusinessPermissionRelationEntity>(db, 'test.business_permission_relations');
  return { resolver: new BusinessPermissionResolver(grants, relations, undefined, { rootExists, isTenantAdministrator }), grants, relations };
}

describe('BusinessPermissionResolver', () => {
  it('权限读取路径合并最新关系投影，创建授权仍会持久化刷新', async () => {
    let projectionCalls = 0;
    const db = new PgliteDatabase();
    const grants = new PgDocumentRepository<BusinessPermissionGrantEntity>(db, 'test.no_side_effect.grants');
    const relations = new PgDocumentRepository<BusinessPermissionRelationEntity>(db, 'test.no_side_effect.relations');
    const resolver = new BusinessPermissionResolver(grants, relations, undefined, {
      rootExists: async () => true,
      projectRelations: async () => {
        projectionCalls += 1;
        return [{ relatedObjectType: 'service_asset', relatedObjectId: 'app_1', relation: 'application-root' }];
      },
    });
    const subject = { id: 'u1', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
    await resolver.resolveGrant({ tenantId: 'tenant_a', domain: 'application', level: 'user', rootObjectType: 'service_asset', rootObjectId: 'app_1', effect: 'allow' });
    await resolver.list(subject);
    assert.equal(projectionCalls, 1);
    await resolver.create({ tenantId: 'tenant_a', principalType: 'user', principalId: 'u1', roleId: 'r1', domain: 'application', level: 'user', rootObjectType: 'service_asset', rootObjectId: 'app_1', createdBy: 'admin' });
    assert.equal(projectionCalls, 3);
  });
  it('固定四个业务域和两个级别，并拒绝未知根对象', async () => {
    const { resolver } = createResolver();
    assert.deepEqual(BUSINESS_PERMISSION_DOMAINS, ['certificate', 'application', 'audit', 'settings']);
    assert.deepEqual(BUSINESS_PERMISSION_LEVELS, ['user', 'manager']);
    await assert.rejects(
      resolver.create({
        tenantId: 'tenant_a', principalType: 'user', principalId: 'u1', roleId: 'r1',
        domain: 'application', level: 'manager', rootObjectType: 'deployment_plan', rootObjectId: 'p1', createdBy: 'admin',
      }),
      (error: unknown) => error instanceof Error && error.message.includes('权限不足'),
    );
  });

  it('预置模板只是业务域和级别组合，历史动作名统一归一化', async () => {
    assert.deepEqual(BUSINESS_PERMISSION_PRESETS.map((item) => item.id), [
      'certificate.viewer', 'certificate.manager', 'application.viewer', 'application.manager',
    ]);
    assert.equal(BUSINESS_PERMISSION_ACTION_ALIASES['service_asset.manage'], 'application.update');
    assert.equal(BUSINESS_PERMISSION_ACTION_ALIASES['certificate.format.create'], 'certificate.artifact.export');
  });

  it('重复提交同一业务授权保持幂等', async () => {
    const { resolver } = createResolver(async ({ tenantId, objectId }) => tenantId === 'tenant_a' && objectId === 'cert_1');
    const input = {
      tenantId: 'tenant_a', principalType: 'user' as const, principalId: 'u1', roleId: 'r1',
      domain: 'certificate' as const, level: 'user' as const, rootObjectType: 'certificate', rootObjectId: 'cert_1', createdBy: 'admin',
    };
    const first = await resolver.create(input);
    const second = await resolver.create(input);
    assert.equal(second.id, first.id);
    assert.equal((await resolver.list()).length, 1);
  });

  it('应用根对象可直接授权，关联低基数资源时返回应用业务资源', async () => {
    const { resolver } = createResolver();
    const denied = await resolver.resolveGrant({ tenantId: 'tenant_a', domain: 'application', level: 'manager', rootObjectType: 'service_asset', rootObjectId: 'app_1', effect: 'allow' });
    assert.equal(denied.allowed, true);
    assert.equal(denied.reason, 'allow');

    for (const [objectType, objectId, relation] of [
      ['device_asset', 'device_1', 'application-device'],
      ['certificate_binding', 'binding_1', 'application-certificate'],
      ['monitor_target', 'monitor_1', 'application-monitor-target'],
      ['monitor_risk', 'risk_1', 'application-monitor-risk'],
      ['monitor_dashboard', 'dashboard_1', 'application-monitor-dashboard'],
    ] as const) {
      await resolver.upsertRelation({ tenantId: 'tenant_a', rootDomain: 'application', rootObjectType: 'service_asset', rootObjectId: 'app_1', relatedObjectType: objectType, relatedObjectId: objectId, relation });
    }
    const resolved = await resolver.resolveGrant({ tenantId: 'tenant_a', domain: 'application', level: 'manager', rootObjectType: 'service_asset', rootObjectId: 'app_1', effect: 'allow' });
    assert.equal(resolved.allowed, true);
    assert.deepEqual(new Set(resolved.relatedResources.map((item) => item.objectType)), new Set(['service_asset', 'device_asset', 'certificate_binding', 'monitor_target', 'monitor_risk', 'monitor_dashboard']));
    assert.equal(resolved.relatedResources.some((item) => item.actions.includes('application.monitor.read')), true);
  });

  it('应用管理授权只能编辑已有应用，不能匹配无对象 ID 的创建动作', async () => {
    const { resolver } = createResolver();
    await resolver.upsertRelation({
      tenantId: 'tenant_a',
      rootDomain: 'application',
      rootObjectType: 'service_asset',
      rootObjectId: 'app_1',
      relatedObjectType: 'device_asset',
      relatedObjectId: 'device_1',
      relation: 'application-device',
    });
    await resolver.create({
      tenantId: 'tenant_a',
      principalType: 'user',
      principalId: 'u1',
      roleId: 'r1',
      domain: 'application',
      level: 'manager',
      rootObjectType: 'service_asset',
      rootObjectId: 'app_1',
      createdBy: 'admin',
    });
    const subject = { id: 'u1', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
    assert.equal(await resolver.isActionAllowed(subject, 'application.update', { type: 'service_asset', id: 'app_1', tenantId: 'tenant_a' }), true);
    assert.equal(await resolver.isActionAllowed(subject, 'application.deployment.execute', { type: 'service_asset', id: 'app_1', tenantId: 'tenant_a' }), true);
    assert.equal(await resolver.isActionAllowed(subject, 'application.create', { type: 'service_asset', tenantId: 'tenant_a' }), false);
  });

  it('证书产物导出按证书版本或格式对象分别校验，不混用对象 ID', async () => {
    const { resolver } = createResolver();
    await resolver.upsertRelation({
      tenantId: 'tenant_a',
      rootDomain: 'certificate',
      rootObjectType: 'certificate',
      rootObjectId: 'cert_1',
      relatedObjectType: 'certificate_version',
      relatedObjectId: 'version_1',
      relation: 'certificate-version',
    });
    await resolver.upsertRelation({
      tenantId: 'tenant_a',
      rootDomain: 'certificate',
      rootObjectType: 'certificate',
      rootObjectId: 'cert_1',
      relatedObjectType: 'certificate_version_format',
      relatedObjectId: 'format_1',
      relation: 'certificate-format',
    });
    await resolver.create({
      tenantId: 'tenant_a',
      principalType: 'user',
      principalId: 'u1',
      roleId: 'r1',
      domain: 'certificate',
      level: 'manager',
      rootObjectType: 'certificate',
      rootObjectId: 'cert_1',
      createdBy: 'admin',
    });
    const subject = { id: 'u1', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
    assert.equal(await resolver.isActionAllowed(subject, 'certificate.artifact.export', { type: 'certificate_version', id: 'version_1', tenantId: 'tenant_a' }), true);
    assert.equal(await resolver.isActionAllowed(subject, 'certificate.artifact.export', { type: 'certificate_version_format', id: 'format_1', tenantId: 'tenant_a' }), true);
    assert.equal(await resolver.isActionAllowed(subject, 'certificate.artifact.export', { type: 'certificate_version_format', id: 'version_1', tenantId: 'tenant_a' }), false);
  });

  it('证书管理授权只能向已有证书导入版本，不能凭空创建新证书', async () => {
    const { resolver } = createResolver();
    await resolver.upsertRelation({
      tenantId: 'tenant_a',
      rootDomain: 'certificate',
      rootObjectType: 'certificate',
      rootObjectId: 'cert_1',
      relatedObjectType: 'certificate_asset',
      relatedObjectId: 'cert_1',
      relation: 'certificate-asset',
    });
    await resolver.create({
      tenantId: 'tenant_a',
      principalType: 'user',
      principalId: 'u1',
      roleId: 'r1',
      domain: 'certificate',
      level: 'manager',
      rootObjectType: 'certificate',
      rootObjectId: 'cert_1',
      createdBy: 'admin',
    });
    const subject = { id: 'u1', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
    assert.equal(await resolver.isActionAllowed(subject, 'certificate.import', { type: 'certificate_asset', id: 'cert_1', tenantId: 'tenant_a' }), true);
    assert.equal(await resolver.isActionAllowed(subject, 'certificate.create', { type: 'certificate_asset', tenantId: 'tenant_a' }), false);
  });

  it('投影关系使用有界稳定存储键，不会因长对象标识失败或重复写入', async () => {
    const db = new PgliteDatabase();
    const grants = new PgDocumentRepository<BusinessPermissionGrantEntity>(db, 'test.business_permission_grants_long_relation');
    const relations = new PgDocumentRepository<BusinessPermissionRelationEntity>(db, 'test.business_permission_relations_long_relation');
    const rootObjectId = `certasset_${'a'.repeat(96)}`;
    const relatedObjectId = `certificate_version_${'b'.repeat(96)}`;
    const projectedRelation = {
      relatedObjectType: 'certificate_version',
      relatedObjectId,
      relation: 'certificate-version',
    };
    const resolver = new BusinessPermissionResolver(grants, relations, undefined, {
      rootExists: async ({ tenantId, objectId }) => tenantId === 'tenant_1234567890abcdef' && objectId === rootObjectId,
      projectRelations: async () => [projectedRelation],
    });

    const input = {
      tenantId: 'tenant_1234567890abcdef',
      domain: 'certificate' as const,
      level: 'user' as const,
      rootObjectType: 'certificate',
      rootObjectId,
      effect: 'allow' as const,
    };
    const first = await resolver.create({ ...input, principalType: 'user', principalId: 'u1', roleId: 'r1', createdBy: 'admin' });
    const second = await resolver.create({ ...input, principalType: 'user', principalId: 'u1', roleId: 'r1', createdBy: 'admin' });
    const rows = await relations.list();

    assert.equal(first.status, 'active');
    assert.equal(second.id, first.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id.startsWith('bprel_'), true);
    assert.ok((rows[0]?.id.length ?? Infinity) <= 128);
    assert.equal(rows[0]?.relatedObjectId, relatedObjectId);
  });

  it('业务 deny、撤销和根对象租户校验不会放大范围', async () => {
    const { resolver } = createResolver(async ({ tenantId, objectId }) => tenantId === 'tenant_a' && objectId === 'cert_1');
    const deny = await resolver.create({
      tenantId: 'tenant_a', principalType: 'user', principalId: 'u1', roleId: 'r1',
      domain: 'certificate', level: 'user', rootObjectType: 'certificate', rootObjectId: 'cert_1', effect: 'deny', createdBy: 'admin',
    });
    const allow = await resolver.create({
      tenantId: 'tenant_a', principalType: 'user', principalId: 'u1', roleId: 'r1',
      domain: 'certificate', level: 'user', rootObjectType: 'certificate', rootObjectId: 'cert_1', effect: 'allow', createdBy: 'admin',
    });
    const denied = await resolver.resolveForSubject({ id: 'u1', type: 'user', scope: { tenantId: 'tenant_a' } }, 'certificate', 'user', { tenantId: 'tenant_a', objectType: 'certificate', objectId: 'cert_1' });
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'explicit business deny');
    await resolver.revoke(deny.id, deny.version);
    const allowed = await resolver.resolveForSubject({ id: 'u1', type: 'user', scope: { tenantId: 'tenant_a' } }, 'certificate', 'user', { tenantId: 'tenant_a', objectType: 'certificate', objectId: 'cert_1' });
    assert.equal(allowed.allowed, true);
    await resolver.revoke(allow.id, allow.version);
    const revoked = await resolver.resolveForSubject({ id: 'u1', type: 'user', scope: { tenantId: 'tenant_a' } }, 'certificate', 'user', { tenantId: 'tenant_a', objectType: 'certificate', objectId: 'cert_1' });
    assert.equal(revoked.allowed, false);
    await assert.rejects(resolver.create({
      tenantId: 'tenant_b', principalType: 'user', principalId: 'u1', roleId: 'r1',
      domain: 'certificate', level: 'user', rootObjectType: 'certificate', rootObjectId: 'cert_1', createdBy: 'admin',
    }));
  });

  it('业务 allow 与旧技术 deny 同时命中时最终拒绝', async () => {
    const db = new PgliteDatabase();
    const grants = new PgDocumentRepository<BusinessPermissionGrantEntity>(db, 'test.business_permission_grants_deny');
    const relations = new PgDocumentRepository<BusinessPermissionRelationEntity>(db, 'test.business_permission_relations_deny');
    const resolver = new BusinessPermissionResolver(grants, relations, {
      resolvePrincipals: async () => [{ type: 'user', id: 'u1' }],
      can: async () => ({ allowed: false, accessLevel: 'read', action: 'certificate.read', reason: 'explicit deny', matchedBindings: [], matchedObjectSets: [], matchedActions: [], requiresApproval: false }),
    });
    await resolver.create({
      tenantId: 'tenant_a', principalType: 'user', principalId: 'u1', roleId: 'r1',
      domain: 'certificate', level: 'user', rootObjectType: 'certificate', rootObjectId: 'cert_1', createdBy: 'admin',
    });
    const result = await resolver.resolveForSubject({ id: 'u1', type: 'user', scope: { tenantId: 'tenant_a' } }, 'certificate', 'user', { tenantId: 'tenant_a', objectType: 'certificate', objectId: 'cert_1' });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'legacy technical deny');
  });

  it('租户 owner/admin 只在当前有效租户内派生全功能，显式 deny 仍优先', async () => {
    let active = true;
    const { resolver } = createResolver(undefined, async ({ subject, tenantId }) => active && subject.id === 'owner_1' && tenantId === 'tenant_a');
    const subject = { id: 'owner_1', type: 'user' as const, scope: { tenantId: 'tenant_a' } };
    assert.equal((await resolver.resolveForSubject(subject, 'settings', 'manager', { tenantId: 'tenant_a', objectType: 'system_setting' })).allowed, true);
    assert.equal((await resolver.resolveForSubject(subject, 'settings', 'manager', { tenantId: 'tenant_b', objectType: 'system_setting' })).allowed, false);
    await resolver.create({
      tenantId: 'tenant_a', principalType: 'user', principalId: 'owner_1', roleId: 'role_owner',
      domain: 'settings', level: 'manager', rootObjectType: 'system_setting', effect: 'deny', createdBy: 'system',
    });
    assert.equal((await resolver.resolveForSubject(subject, 'settings', 'manager', { tenantId: 'tenant_a', objectType: 'system_setting' })).reason, 'explicit business deny');
    active = false;
    assert.equal((await resolver.resolveForSubject(subject, 'settings', 'manager', { tenantId: 'tenant_a', objectType: 'system_setting' })).allowed, false);
  });

});
