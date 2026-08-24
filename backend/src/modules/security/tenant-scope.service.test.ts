import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TenantEntity, TenantMembershipEntity, TenantMembershipType } from '../../persistence/entities/tenant.entity.js';
import type { TenantContext } from '../../shared/security-types.js';
import { TenantScopeService } from './tenant-scope.service.js';

const service = new TenantScopeService();
const tenants = [
  tenant('group_a', 'group-a', 'GROUP'),
  tenant('company_a', 'company-a', 'COMPANY', 'group_a'),
  tenant('company_a_nested', 'company-a-nested', 'COMPANY', 'company_a'),
  tenant('group_b', 'group-b', 'GROUP'),
  tenant('company_b', 'company-b', 'COMPANY', 'group_b'),
  tenant('company_suspended', 'company-suspended', 'COMPANY', 'group_a', 'SUSPENDED'),
];

describe('TenantScopeService', () => {
  it('规范化 SELF、SUBTREE、EXPLICIT 和 SYSTEM 范围', () => {
    assert.deepEqual(service.normalize({ type: 'SELF' }, tenants, 'company_a'), {
      type: 'SELF',
      rootTenantId: 'company_a',
      tenantIds: ['company_a'],
    });
    assert.deepEqual(service.normalize({ type: 'SUBTREE', rootTenantId: 'group_a' }, tenants), {
      type: 'SUBTREE',
      rootTenantId: 'group_a',
      tenantIds: ['group_a', 'company_a'],
    });
    assert.deepEqual(service.normalize({ type: 'EXPLICIT', tenantIds: ['company_b', 'company_a', 'company_b'] }, tenants), {
      type: 'EXPLICIT',
      tenantIds: ['company_b', 'company_a'],
    });
    assert.deepEqual(service.normalize({ type: 'SYSTEM', rootTenantId: 'group_a', tenantIds: ['company_a'] }, tenants), {
      type: 'SYSTEM',
    });
  });

  it('拒绝非法子树和包含停用租户的明确范围', () => {
    assert.throws(
      () => service.normalize({ type: 'SUBTREE', rootTenantId: 'company_a' }, tenants),
      { errorCode: 'TENANT_SCOPE_DENIED' },
    );
    assert.throws(
      () => service.normalize({ type: 'EXPLICIT', tenantIds: ['company_suspended'] }, tenants),
      { errorCode: 'TENANT_SCOPE_DENIED' },
    );
    assert.throws(
      () => service.normalize({ type: 'EXPLICIT', tenantIds: [] }, tenants),
      { errorCode: 'TENANT_SCOPE_DENIED' },
    );
  });

  it('SYSTEM 只匹配系统资源，集团共享资源默认关闭', () => {
    const self = service.normalize({ type: 'SELF', rootTenantId: 'company_a' }, tenants);
    const subtree = service.normalize({ type: 'SUBTREE', rootTenantId: 'group_a' }, tenants);
    const explicit = service.normalize({ type: 'EXPLICIT', tenantIds: ['company_b'] }, tenants);
    const system = service.normalize({ type: 'SYSTEM' }, tenants);

    assert.equal(service.allowsResource(self, { tenantId: 'company_a' }), true);
    assert.equal(service.allowsResource(self, { tenantId: 'company_b' }), false);
    assert.equal(service.allowsResource(subtree, { tenantId: 'company_a' }), true);
    assert.equal(service.allowsResource(subtree, { tenantId: 'company_b' }), false);
    assert.equal(service.allowsResource(explicit, { tenantId: 'company_b' }), true);
    assert.equal(service.allowsResource(system, { ownerType: 'SYSTEM' }), true);
    assert.equal(service.allowsResource(system, { tenantId: 'company_a' }), false);
    assert.equal(service.allowsResource(subtree, { ownerType: 'SYSTEM' }), false);
    assert.equal(service.allowsResource(subtree, { ownerType: 'GROUP', tenantId: 'group_a' }), false);
  });

  it('子树治理不等于进入权限，直接成员关系始终优先', () => {
    const memberships = [
      membership('membership_group_admin', 'group_a', 'admin'),
      membership('membership_company_member', 'company_a', 'member'),
    ];
    const context: TenantContext = {
      mode: 'hierarchical',
      actorId: 'user_scope',
      currentTenantId: 'group_a',
      homeTenantId: 'group_a',
      accessibleTenantIds: ['group_a', 'company_a'],
      managementScope: service.normalize({ type: 'SUBTREE', rootTenantId: 'group_a' }, tenants),
      version: 'ctx_scope',
    };

    const accessible = service.resolveAccessibleTenants(memberships, tenants, context);
    const group = accessible.find((item) => item.tenantId === 'group_a');
    const company = accessible.find((item) => item.tenantId === 'company_a');

    assert.equal(group?.scopeType, 'SUBTREE');
    assert.equal(group?.canSwitch, true);
    assert.equal(company?.scopeType, 'EXPLICIT');
    assert.equal(company?.canSwitch, true);
    assert.equal(accessible.some((item) => item.tenantId === 'group_b'), false);
    assert.equal(accessible.some((item) => item.tenantId === 'company_a_nested'), false);
  });
});

function tenant(
  id: string,
  code: string,
  type: TenantEntity['type'],
  parentId?: string,
  status: TenantEntity['status'] = 'ACTIVE',
): TenantEntity {
  return {
    id,
    code,
    name: code,
    type,
    parentId,
    status,
    settings: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    version: 1,
  };
}

function membership(id: string, tenantId: string, membershipType: TenantMembershipType): TenantMembershipEntity {
  return {
    id,
    subjectType: 'user',
    subjectId: 'user_scope',
    tenantId,
    membershipType,
    status: 'ACTIVE',
    effectiveFrom: '2026-08-06T00:00:00.000Z',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    version: 1,
  };
}
