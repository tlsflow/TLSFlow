import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalService } from './approval.service.js';
import { AuditService } from '../audits/audit.service.js';

test('审批状态机阻止自批并检测参数偷换', () => {
  const approvals = new ApprovalService(undefined, new AuditService());
  const created = approvals.create({
    operationType: 'deployment.execute',
    resourceRefs: [{ type: 'deployment', id: 'dep_1' }],
    riskLevel: 'high',
    parameters: { targets: ['a', 'b'], restart: false },
    requestedBy: 'user_a',
  });

  assert.throws(() => approvals.decide({ approvalId: created.id, decision: 'approved', approverId: 'user_a' }), (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID');
  const approved = approvals.decide({ approvalId: created.id, decision: 'approved', approverId: 'user_b', comment: '同意' });
  assert.equal(approved.status, 'approved');
  assert.throws(() => approvals.consume(created.id, { targets: ['a', 'b'], restart: true }), (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID');
});
