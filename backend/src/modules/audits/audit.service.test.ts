import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RBACService } from '../rbac/rbac.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService 权限查询', () => {
  it('审计查询会通过 RBAC 校验资源作用域', () => {
    const audit = new AuditService();
    const rbac = new RBACService();
    const subject = { id: 'user_audit', type: 'user' as const };

    rbac.createPolicy({
      subjectType: 'user',
      subjectId: subject.id,
      effect: 'allow',
      actions: ['audit.read'],
      resourceTypes: ['secret'],
      scope: { tenantId: 'tenant_1', environment: 'prod' },
    });

    audit.write({
      eventType: 'secret.used',
      actorType: 'executor',
      actorId: 'ssh',
      action: 'secret.resolve',
      resourceType: 'secret',
      resourceId: 'sec_1',
      result: 'success',
      riskLevel: 'high',
      detail: { token: 'must-redact' },
    });

    const allowed = audit.queryWithPermission({
      subject,
      query: {
        resourceType: 'secret',
        resourceId: 'sec_1',
        resourceScope: { tenantId: 'tenant_1', environment: 'prod' },
      },
      assertCan: rbac.assertCan.bind(rbac),
    });
    assert.equal(allowed.length, 1);

    assert.throws(
      () => audit.queryWithPermission({
        subject,
        query: {
          resourceType: 'secret',
          resourceId: 'sec_1',
          resourceScope: { tenantId: 'tenant_2', environment: 'prod' },
        },
        assertCan: rbac.assertCan.bind(rbac),
      }),
      (error: any) => error.errorCode === 'SEC_PERMISSION_DENIED',
    );
  });
});
