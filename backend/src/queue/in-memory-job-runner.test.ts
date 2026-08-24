import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../common/errors/app-error.js';
import { runWithRequestContext } from '../common/tracing/request-context.js';
import { InMemoryJobRunner } from './in-memory-job-runner.js';

describe('队列基础能力', () => {
  it('入队任务继承 requestId、tenantId 和 actorId', async () => {
    const queue = new InMemoryJobRunner();
    const job = await runWithRequestContext(
      { requestId: 'req_queue', traceId: 'trace_queue', tenantId: 'tenant_1', actorId: 'actor_1' },
      () => queue.enqueue({ jobType: 'MONITOR_CHECK', payload: { target: 'example.com' }, resourceType: 'MonitorTarget', resourceId: 'target_1' }),
    );
    assert.equal(job.requestId, 'req_queue');
    assert.equal(job.traceId, 'trace_queue');
    assert.equal(job.tenantId, 'tenant_1');
    assert.equal(job.actorId, 'actor_1');
    assert.equal(queue.size(), 1);
  });

  it('重复幂等键会被拒绝', async () => {
    const queue = new InMemoryJobRunner();
    await queue.enqueue({ jobType: 'DEPLOYMENT_EXECUTE', idempotencyKey: 'key_1', payload: {} });
    await assert.rejects(() => queue.enqueue({ jobType: 'DEPLOYMENT_EXECUTE', idempotencyKey: 'key_1', payload: {} }), AppError);
  });
});
