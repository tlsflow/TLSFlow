import test from 'node:test';
import assert from 'node:assert/strict';
import { RBACService } from './rbac.service.js';
import { AuditService } from '../audits/audit.service.js';

test('RBAC 支持作用域匹配和 deny 优先', () => {
  const audit = new AuditService();
  const rbac = new RBACService(undefined, undefined, undefined, undefined, audit);
  rbac.createPolicy({
    id: 'allow_prod_team_a',
    subjectType: 'role',
    subjectId: 'role_operator',
    effect: 'allow',
    actions: ['deployment.execute'],
    resourceTypes: ['deployment'],
    scope: { teamId: 'team_a', environment: 'prod' },
  });
  rbac.createPolicy({
    id: 'deny_zone_x',
    subjectType: 'role',
    subjectId: 'role_operator',
    effect: 'deny',
    actions: ['deployment.execute'],
    resourceTypes: ['deployment'],
    scope: { zoneId: 'zone_x' },
  });

  const subject = { id: 'user_1', type: 'user' as const, roleIds: ['role_operator'] };
  assert.equal(rbac.can(subject, 'deployment.execute', { type: 'deployment', scope: { teamId: 'team_a', environment: 'prod' } }).allowed, true);
  const denied = rbac.can(subject, 'deployment.execute', { type: 'deployment', id: 'dep_1', scope: { teamId: 'team_a', environment: 'prod', zoneId: 'zone_x' } });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'explicit deny');
  assert.equal(audit.query({ eventType: 'permission.denied' }).length, 1);
});
