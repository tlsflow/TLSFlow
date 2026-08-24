import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runWithRequestContext } from '../common/tracing/request-context.js';
import { PgliteDatabase } from '../database/pglite-database.js';
import { PgJobRunner } from './pg-job-runner.js';

describe('PgJobRunner 请求上下文与重试', () => {
  it('入队任务继承 requestId、tenantId 和 actorId', async () => {
    const db = new PgliteDatabase();
    const queue = new PgJobRunner(undefined, db);
    const job = await runWithRequestContext(
      { requestId: 'req_queue', traceId: 'trace_queue', tenantId: 'tenant_1', actorId: 'actor_1' },
      () => queue.enqueue({ jobType: 'MONITOR_CHECK', payload: { target: 'example.com' }, resourceType: 'MonitorTarget', resourceId: 'target_1' }),
    );

    assert.equal(job.requestId, 'req_queue');
    assert.equal(job.traceId, 'trace_queue');
    assert.equal(job.tenantId, 'tenant_1');
    assert.equal(job.actorId, 'actor_1');
    assert.equal(await queue.size(), 1);
  });
});
