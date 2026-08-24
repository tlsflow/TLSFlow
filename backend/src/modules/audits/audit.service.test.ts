import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RBACService } from '../rbac/rbac.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService 审计权限过滤', () => {
  it('查询审计日志时必须通过 RBAC 权限校验', async () => {
    const audit = new AuditService();
    const rbac = new RBACService();
    const subject = { id: 'user_audit', type: 'user' as const };

    await rbac.createPolicy({
      subjectType: 'user',
      subjectId: subject.id,
      effect: 'allow',
      actions: ['audit.read'],
      resourceTypes: ['secret'],
      scope: { tenantId: 'tenant_1', environment: 'prod' },
    });

    await audit.write({
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

    const allowed = await audit.queryWithPermission({
      subject,
      query: {
        resourceType: 'secret',
        resourceId: 'sec_1',
        resourceScope: { tenantId: 'tenant_1', environment: 'prod' },
      },
      assertCan: rbac.assertCan.bind(rbac),
    });
    assert.equal(allowed.length, 1);

    await assert.rejects(
      () =>
        audit.queryWithPermission({
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
