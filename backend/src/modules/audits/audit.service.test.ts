import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RBACService } from '../rbac/rbac.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService 审计权限过滤', () => {
  it('无请求上下文时使用注入的真实默认租户 UUID', async () => {
    const audit = new AuditService(undefined, undefined, async () => 'tenant-default-uuid');

    const saved = await audit.write({
      eventType: 'task.created',
      actorType: 'system',
      actorId: 'task-worker',
      action: 'task.create',
      resourceType: 'task',
      resourceId: 'task_1',
      result: 'success',
      riskLevel: 'medium',
    });

    assert.equal(saved.tenantId, 'tenant-default-uuid');
  });

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

  it('租户查询只返回写入时携带相同租户上下文的审计记录', async () => {
    const audit = new AuditService();

    await audit.write({
      eventType: 'secret.created',
      actorType: 'user',
      actorId: 'user_a',
      action: 'secret.create',
      resourceType: 'secret',
      resourceId: 'sec_a',
      result: 'success',
      riskLevel: 'medium',
      context: { tenantId: 'tenant_a', requestId: 'req_a' },
    });
    await audit.write({
      eventType: 'secret.created',
      actorType: 'user',
      actorId: 'user_b',
      action: 'secret.create',
      resourceType: 'secret',
      resourceId: 'sec_b',
      result: 'success',
      riskLevel: 'medium',
      context: { tenantId: 'tenant_b', requestId: 'req_b' },
    });

    const tenantAItems = await audit.query({ tenantId: 'tenant_a', resourceType: 'secret' });
    assert.equal(tenantAItems.length, 1);
    assert.equal(tenantAItems[0]?.actorId, 'user_a');
    assert.equal(tenantAItems[0]?.tenantId, 'tenant_a');
  });
});
