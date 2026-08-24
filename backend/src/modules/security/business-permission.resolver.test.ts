import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { BusinessPermissionGrantEntity, BusinessPermissionRelationEntity } from '../../persistence/entities/business-permission.entity.js';
import { BUSINESS_PERMISSION_DOMAINS, BUSINESS_PERMISSION_LEVELS } from '../../persistence/entities/business-permission.entity.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { BusinessPermissionResolver } from './business-permission.resolver.js';

function createResolver(rootExists?: (input: { tenantId: string; objectType: string; objectId: string }) => Promise<boolean>) {
  const db = new PgliteDatabase();
  const grants = new PgDocumentRepository<BusinessPermissionGrantEntity>(db, 'test.business_permission_grants');
  const relations = new PgDocumentRepository<BusinessPermissionRelationEntity>(db, 'test.business_permission_relations');
  return { resolver: new BusinessPermissionResolver(grants, relations, undefined, { rootExists }), grants, relations };
}

describe('BusinessPermissionResolver', () => {
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

  it('应用关系缺失时失败关闭，关联完整时返回部署链路资源', async () => {
    const { resolver } = createResolver();
    const denied = await resolver.resolveGrant({ tenantId: 'tenant_a', domain: 'application', level: 'manager', rootObjectType: 'service_asset', rootObjectId: 'app_1', effect: 'allow' });
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'application relations missing');

    for (const [objectType, objectId, relation] of [
      ['device_asset', 'device_1', 'application-device'],
      ['certificate_binding', 'binding_1', 'application-certificate'],
      ['deployment_plan', 'plan_1', 'application-plan'],
      ['workflow', 'workflow_1', 'application-workflow'],
      ['execution_run', 'run_1', 'application-execution'],
    ] as const) {
      await resolver.upsertRelation({ tenantId: 'tenant_a', rootDomain: 'application', rootObjectType: 'service_asset', rootObjectId: 'app_1', relatedObjectType: objectType, relatedObjectId: objectId, relation });
    }
    const resolved = await resolver.resolveGrant({ tenantId: 'tenant_a', domain: 'application', level: 'manager', rootObjectType: 'service_asset', rootObjectId: 'app_1', effect: 'allow' });
    assert.equal(resolved.allowed, true);
    assert.deepEqual(new Set(resolved.relatedResources.map((item) => item.objectType)), new Set(['service_asset', 'device_asset', 'certificate_binding', 'deployment_plan', 'workflow', 'execution_run']));
    assert.equal(resolved.relatedResources.some((item) => item.actions.includes('application.deployment.submit')), true);
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
    const first = await resolver.resolveGrant(input);
    const second = await resolver.resolveGrant(input);
    const rows = await relations.list();

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
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

});
