import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from './security.controller.js';

describe('安全 API 最小闭环', () => {
  it('Secret 创建只返回元数据和 SecretRef，并写入审计', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_secret',
      effect: 'allow',
      actions: ['secret.create', 'secret.read', 'audit.read'],
      resourceTypes: ['secret'],
      scope: { tenantId: 'tenant_1' },
    });
    const app = createApp({ security });

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret', 'x-request-id': 'req_secret_api' },
      body: {
        name: '生产 SSH Key',
        type: 'ssh_key',
        scopeType: 'team',
        scopeId: 'team_ops',
        plainText: 'super-secret-private-key',
      },
    });

    assert.equal(created.statusCode, 201);
    const secret = created.body as { id: string; secretRef: string; plainText?: string };
    assert.equal(secret.secretRef.startsWith('secret://ssh_key/'), true);
    assert.equal(secret.plainText, undefined);

    const metadata = await app.inject({
      method: 'GET',
      path: `/api/v1/secrets/metadata?id=${secret.id}`,
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret' },
    });
    assert.equal(metadata.statusCode, 200);
    assert.equal((metadata.body as { id: string }).id, secret.id);

    const audits = await app.inject({
      method: 'GET',
      path: '/api/v1/audit-events?resourceType=secret&eventType=secret.created',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_secret' },
    });
    assert.equal(audits.statusCode, 200);
    assert.equal((audits.body as { items: unknown[] }).items.length, 1);
  });

  it('审批 API 支持创建和他人审批，且无权限审计查询会被拒绝', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'requester',
      effect: 'allow',
      actions: ['approval.create'],
      resourceTypes: ['approval'],
      scope: { tenantId: 'tenant_1' },
    });
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'approver',
      effect: 'allow',
      actions: ['approval.decide'],
      resourceTypes: ['approval'],
      scope: { tenantId: 'tenant_1' },
    });
    const app = createApp({ security });

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/approvals',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'requester' },
      body: {
        operationType: 'deployment.execute',
        resourceRefs: [{ type: 'execution', id: 'run_1' }],
        riskLevel: 'high',
        parameters: { runId: 'run_1', stepId: 'step_1' },
      },
    });
    assert.equal(created.statusCode, 201);
    const approvalId = (created.body as { id: string }).id;

    const decided = await app.inject({
      method: 'POST',
      path: '/api/v1/approvals/decide',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'approver' },
      body: { approvalId, decision: 'approved', comment: '同意执行' },
    });
    assert.equal(decided.statusCode, 200);
    assert.equal((decided.body as { status: string }).status, 'approved');

    const deniedAudit = await app.inject({
      method: 'GET',
      path: '/api/v1/audit-events?resourceType=approval',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'requester' },
    });
    assert.equal(deniedAudit.statusCode, 403);
    assert.equal((deniedAudit.body as { errorCode: string }).errorCode, 'SEC_PERMISSION_DENIED');
  });
});
