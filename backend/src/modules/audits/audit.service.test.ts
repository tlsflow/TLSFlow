import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
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
    assert.equal(allowed.length, 0);

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

  it('查询时过滤 Secret 和默认权限拒绝，但保留显式权限阻断', async () => {
    const db = new PgliteDatabase();
    try {
      const logs = new PgDocumentRepository<AuditLogEntity>(db, 'security.audit_logs');
      const audit = new AuditService(logs, undefined, undefined, db);
      const base: AuditLogEntity = {
        id: 'aud_http_header',
        tenantId: 'tenant_a',
        eventType: 'secret.used',
        actorType: 'user',
        actorId: 'user_a',
        action: 'secret.resolve.service',
        resourceType: 'secret',
        resourceId: 'sec_http',
        result: 'success',
        riskLevel: 'high',
        createdAt: '2026-08-18T00:00:00.000Z',
        detail: { purpose: 'http.header' },
      };
      await logs.create(base);
      await logs.create({ ...base, id: 'aud_ldap', resourceId: 'sec_ldap', detail: { purpose: 'ldap.bind' } });
      await logs.create({
        ...base,
        id: 'aud_permission_default',
        eventType: 'permission.denied',
        action: 'task.read',
        resourceType: 'task',
        resourceId: 'task_1',
        result: 'denied',
        detail: { reason: 'no allow policy' },
      });
      await logs.create({
        ...base,
        id: 'aud_permission_object_default',
        eventType: 'permission.denied',
        action: 'certificate.read',
        resourceType: 'certificate',
        resourceId: 'cert_1',
        result: 'denied',
        detail: { reason: 'no object grant' },
      });
      await logs.create({
        ...base,
        id: 'aud_permission_explicit',
        eventType: 'permission.denied',
        action: 'task.delete',
        resourceType: 'task',
        resourceId: 'task_2',
        result: 'denied',
        detail: { reason: 'explicit deny' },
      });
      await logs.create({
        ...base,
        id: 'aud_permission_tenant',
        eventType: 'permission.denied',
        action: 'task.read',
        resourceType: 'task',
        resourceId: 'task_3',
        result: 'denied',
        detail: { reason: 'tenant scope denied' },
      });
      await logs.create({
        ...base,
        id: 'aud_task',
        eventType: 'task.created',
        action: 'task.create',
        resourceType: 'task',
        resourceId: 'task_4',
        result: 'success',
        detail: undefined,
      });

      const visible = await audit.query();
      assert.deepEqual(visible.map((item) => item.id).sort(), [
        'aud_permission_explicit',
        'aud_permission_tenant',
        'aud_task',
      ]);
    } finally {
      await db.close();
    }
  });

  it('写入时只抑制默认拒绝，保留显式拒绝', async () => {
    const db = new PgliteDatabase();
    try {
      const logs = new PgDocumentRepository<AuditLogEntity>(db, 'security.audit_logs');
      const audit = new AuditService(logs, undefined, undefined, db);
      const base = {
        actorType: 'system' as const,
        actorId: 'system_audit_test',
        action: 'task.read',
        resourceType: 'task',
        resourceId: 'task_write_test',
        result: 'denied' as const,
        riskLevel: 'medium' as const,
        context: { tenantId: 'tenant_write_test' },
      };

      await audit.write({ ...base, eventType: 'secret.used', result: 'success', resourceType: 'secret', action: 'secret.resolve.service', detail: { purpose: 'http.header' } });
      await audit.write({ ...base, eventType: 'permission.denied', detail: { reason: 'no allow policy' } });
      await audit.write({ ...base, eventType: 'permission.denied', resourceId: 'task_explicit', detail: { reason: 'explicit deny' } });
      const persisted = await logs.list();
      assert.deepEqual(persisted.map((item) => item.resourceId).sort(), ['task_explicit']);
      const visible = await audit.query({ tenantId: 'tenant_write_test' });
      assert.deepEqual(visible.map((item) => item.resourceId).sort(), ['task_explicit']);
    } finally {
      await db.close();
    }
  });
});
