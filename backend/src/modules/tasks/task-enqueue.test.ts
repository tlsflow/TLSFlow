import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueTaskBestEffort, isUnifiedTaskWorkerEnabled } from './task-enqueue.js';

test('统一任务开关在 false 时禁止写入统一队列', async () => {
  const previous = process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
  let enqueued = false;
  process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = 'false';
  try {
    enqueueTaskBestEffort({
      enqueue: async () => {
        enqueued = true;
        throw new Error('不应调用');
      },
    }, {
      tenantId: 'tenant-1',
      taskType: 'REPORT_EXPORT',
      triggerSource: 'test',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(isUnifiedTaskWorkerEnabled(), false);
    assert.equal(enqueued, false);
  } finally {
    if (previous === undefined) delete process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
    else process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = previous;
  }
});
