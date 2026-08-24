import test from 'node:test';
import assert from 'node:assert/strict';
import { RBACService } from './rbac.service.js';
import { AuditService } from '../audits/audit.service.js';

test('RBAC 鏀寔浣滅敤鍩熷尮閰嶅拰 deny 浼樺厛', async () => {
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
