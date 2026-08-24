import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalService } from './approval.service.js';
import { AuditService } from '../audits/audit.service.js';

test('审批不能由申请人自己批准，且审批后参数必须一致', async () => {
  const approvals = new ApprovalService(undefined, new AuditService());
  const created = await approvals.create({
    operationType: 'deployment.execute',
    resourceRefs: [{ type: 'deployment', id: 'dep_1' }],
    riskLevel: 'high',
    parameters: { targets: ['a', 'b'], restart: false },
    requestedBy: 'user_a',
  });

  await assert.rejects(
    () => approvals.decide({ approvalId: created.id, decision: 'approved', approverId: 'user_a' }),
    (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID',
  );

  const approved = await approvals.decide({
    approvalId: created.id,
    decision: 'approved',
    approverId: 'user_b',
    comment: '批准执行',
  });
  assert.equal(approved.status, 'approved');

  await assert.rejects(
    () => approvals.consume(created.id, { targets: ['a', 'b'], restart: true }),
    (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID',
  );
});
