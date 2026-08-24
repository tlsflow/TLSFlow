import test from 'node:test';
import assert from 'node:assert/strict';
import { RBACService } from './rbac.service.js';
import { AuditService } from '../audits/audit.service.js';

test('RBAC 支持作用域匹配和 deny 优先', async () => {
  const audit = new AuditService();
  const rbac = new RBACService(undefined, undefined, undefined, undefined, audit);
  await rbac.createPolicy({
    id: 'allow_prod_team_a',
    subjectType: 'role',
    subjectId: 'role_operator',
    effect: 'allow',
    actions: ['deployment.execute'],
    resourceTypes: ['deployment'],
    scope: { teamId: 'team_a', environment: 'prod' },
  });
  await rbac.createPolicy({
    id: 'deny_zone_x',
    subjectType: 'role',
    subjectId: 'role_operator',
    effect: 'deny',
    actions: ['deployment.execute'],
    resourceTypes: ['deployment'],
    scope: { zoneId: 'zone_x' },
  });

  const subject = { id: 'user_1', type: 'user' as const, roleIds: ['role_operator'] };
  assert.equal((await rbac.can(subject, 'deployment.execute', { type: 'deployment', scope: { teamId: 'team_a', environment: 'prod' } })).allowed, true);
  const denied = await rbac.can(subject, 'deployment.execute', { type: 'deployment', id: 'dep_1', scope: { teamId: 'team_a', environment: 'prod', zoneId: 'zone_x' } });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'explicit deny');
  assert.equal((await audit.query({ eventType: 'permission.denied' })).length, 1);
});

test('RBAC 先校验结构化租户范围，再处理动作策略', async () => {
  const rbac = new RBACService();
  await rbac.createPolicy({
    id: 'allow_group_read',
    subjectType: 'user',
    subjectId: 'user_group_admin',
    effect: 'allow',
    actions: ['host.read'],
    resourceTypes: ['host'],
    scope: { tenantId: '*' },
  });

  const subject = {
    id: 'user_group_admin',
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
  assert.equal((await rbac.can(subject, 'host.read', {
    type: 'host',
    scope: { tenantId: 'company_a', ownerType: 'TENANT' },
  })).allowed, true);

  const sibling = await rbac.can(subject, 'host.read', {
    type: 'host',
    scope: { tenantId: 'company_b', ownerType: 'TENANT' },
  });
  assert.equal(sibling.allowed, false);
  assert.equal(sibling.reason, 'tenant scope denied');

  const system = await rbac.can(subject, 'host.read', {
    type: 'host',
    scope: { ownerType: 'SYSTEM' },
  });
  assert.equal(system.allowed, false);
  assert.equal(system.reason, 'tenant scope denied');
});
