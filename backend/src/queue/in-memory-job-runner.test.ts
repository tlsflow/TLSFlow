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

  it('失败任务在未超过最大次数时重新入队并保留 attempt', async () => {
    let calls = 0;
    const queue = new InMemoryJobRunner(async (job) => {
      calls += 1;
      if (calls === 1) {
        return { jobId: job.jobId, success: false, errorCode: 'TEMPORARY_FAILURE' };
      }
      return { jobId: job.jobId, success: true };
    });

    const job = await queue.enqueue({
      jobType: 'MONITOR_CHECK',
      payload: { target: 'example.com' },
      retryPolicy: { maxAttempts: 2, backoffSeconds: 0 },
    });

    const first = await queue.runNext();
    assert.equal(first?.success, false);
    assert.equal(first?.attempt, 1);
    assert.equal(first?.willRetry, true);
    assert.equal(queue.size(), 1);

    const second = await queue.runNext();
    assert.equal(second?.success, true);
    assert.equal(second?.attempt, 2);
    assert.equal(second?.willRetry, false);
    assert.equal(queue.size(), 0);
    assert.deepEqual(queue.getResult(job.jobId), second);
  });

  it('超过最大尝试次数后失败任务不再重新入队', async () => {
    const queue = new InMemoryJobRunner(async (job) => ({ jobId: job.jobId, success: false, errorCode: 'ALWAYS_FAIL' }));
    await queue.enqueue({
      jobType: 'DEPLOYMENT_EXECUTE',
      payload: {},
      retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    });

    const result = await queue.runNext();
    assert.equal(result?.success, false);
    assert.equal(result?.attempt, 1);
    assert.equal(result?.willRetry, false);
    assert.equal(queue.size(), 0);
  });
});
