import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationNotificationActionService } from './application/automation-notification-actions.js';
import { FakeNotificationPort } from './application/notification-port.js';

test('通知动作传递运行级、目标级上下文并保持幂等', async () => {
  const port = new FakeNotificationPort();
  const service = new AutomationNotificationActionService(port);
  const run = { id: 'run_1', tenantId: 't', automationId: 'aut_1', automationVersion: 2, automationNameSnapshot: '证书更新', triggerType: 'on_demand' as const, idempotencyKey: 'k', status: 'failed' as const, targetSummary: { total: 1, pending: 0, running: 0, waitingApproval: 0, succeeded: 0, failed: 1, skipped: 0, cancelled: 0 }, actionTypes: ['send_notification' as const], environmentSnapshots: ['production'], failureStage: 'verification' as const, createdBy: 'u', createdAt: '' };
  const target = { id: 'target_1', tenantId: 't', runId: 'run_1', sequenceNo: 1, targetSnapshot: { certificateId: 'c', certificateName: 'example.com', tags: [] }, actionTypes: ['send_notification' as const], status: 'failed' as const, failureStage: 'verification' as const, errorCode: 'VERIFY_FAILED', errorMessage: '脱敏摘要', notificationRequestIds: [], createdAt: '', updatedAt: '' };
  const first = await service.enqueue({ tenantId: 't', run, target, config: { templateKey: 'automation.result', eventKey: 'failed', channelId: 'channel_1' }, eventKey: 'failed' });
  const second = await service.enqueue({ tenantId: 't', run, target, config: { templateKey: 'automation.result', eventKey: 'failed', channelId: 'channel_1' }, eventKey: 'failed' });
  assert.equal(first.requestId, second.requestId);
  assert.equal(port.requests.length, 1);
  assert.equal((port.requests[0]?.context.run as { failureStage: string }).failureStage, 'verification');
  assert.equal((port.requests[0]?.context.target as { errorCode: string }).errorCode, 'VERIFY_FAILED');
});

test('通知投递失败只抛出通知错误，不改变调用方运行状态', async () => {
  const port = new FakeNotificationPort();
  port.failWith = new Error('notification unavailable');
  const service = new AutomationNotificationActionService(port);
  await assert.rejects(() => service.enqueue({ tenantId: 't', run: { id: 'r', tenantId: 't', automationId: 'a', automationVersion: 1, automationNameSnapshot: 'A', triggerType: 'on_demand', idempotencyKey: 'k', status: 'succeeded', targetSummary: { total: 0, pending: 0, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 }, actionTypes: ['send_notification'], environmentSnapshots: [], createdBy: 'u', createdAt: '' }, config: { templateKey: 'x', eventKey: 'completed' }, eventKey: 'completed' }));
});
