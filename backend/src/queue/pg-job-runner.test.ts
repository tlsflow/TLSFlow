import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../database/pglite-database.js';
import { PgJobRunner } from './pg-job-runner.js';

describe('PgJobRunner', () => {
  it('入队后可以持久化拉取并执行', async () => {
    const db = new PgliteDatabase();
    const queue = new PgJobRunner(async (job) => ({ jobId: job.jobId, success: true }), db);

    const job = await queue.enqueue({
      jobType: 'DEPLOYMENT_EXECUTE',
      resourceType: 'executionRun',
      resourceId: 'run_1',
      idempotencyKey: 'idem_pg_queue_1',
      payload: { runId: 'run_1' },
    });

    assert.equal(await queue.size(), 1);
    const result = await queue.runNext();
    assert.equal(result?.success, true);
    assert.equal(result?.jobId, job.jobId);
    assert.equal(await queue.size(), 0);
    assert.deepEqual(await queue.getResult(job.jobId), result);
  });

  it('失败任务会按重试策略重新入队', async () => {
    const db = new PgliteDatabase();
    let calls = 0;
    const queue = new PgJobRunner(async (job) => {
      calls += 1;
      return calls === 1
        ? { jobId: job.jobId, success: false, errorCode: 'TEMP' }
        : { jobId: job.jobId, success: true };
    }, db);

    await queue.enqueue({
      jobType: 'DEPLOYMENT_EXECUTE',
      payload: { runId: 'run_retry' },
      retryPolicy: { maxAttempts: 2, backoffSeconds: 0 },
    });

    const first = await queue.runNext();
    assert.equal(first?.success, false);
    assert.equal(first?.willRetry, true);
    assert.equal(await queue.size(), 1);

    const second = await queue.runNext();
    assert.equal(second?.success, true);
    assert.equal(await queue.size(), 0);
  });
});
