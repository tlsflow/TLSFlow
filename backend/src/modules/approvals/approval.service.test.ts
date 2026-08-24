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
    (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID'
      && error.message === '申请人不能批准自己提交的审批',
  );

  const approved = await approvals.decide({
    approvalId: created.id,
    decision: 'approved',
    approverId: 'user_b',
    comment: '批准执行',
  });
  assert.equal(approved.status, 'approved');

  await assert.rejects(
    () => approvals.decide({ approvalId: created.id, decision: 'rejected', approverId: 'user_c' }),
    (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID'
      && error.message === '审批已处理，不能重复审批',
  );

  const second = await approvals.create({
    operationType: 'deployment.execute',
    resourceRefs: [{ type: 'deployment', id: 'dep_2' }],
    riskLevel: 'high',
    parameters: { targets: ['a', 'b'], restart: false },
    requestedBy: 'user_a',
  });
  await approvals.decide({ approvalId: second.id, decision: 'approved', approverId: 'user_b' });
  await assert.rejects(
    () => approvals.consume(second.id, { targets: ['a', 'b'], restart: true }),
    (error: any) => error.errorCode === 'SEC_APPROVAL_INVALID',
  );
});

test('宿主显式允许自审批时，申请人可以完成批准', async () => {
  const approvals = new ApprovalService(undefined, new AuditService(), { allowSelfApproval: true });
  const created = await approvals.create({
    operationType: 'deployment.execute',
    resourceRefs: [{ type: 'deployment', id: 'dep_self_approval' }],
    riskLevel: 'high',
    parameters: { planId: 'plan_self_approval' },
    requestedBy: 'user_self',
  });

  const approved = await approvals.decide({
    approvalId: created.id,
    decision: 'approved',
    approverId: 'user_self',
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedBy, 'user_self');
});
