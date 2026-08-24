import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CurlExecutor } from './curl.executor.js';

describe('spec017 CURL executeStep 契约', () => {
  it('missing curlRequest 不允许伪成功', async () => {
    const executor = new CurlExecutor();
    const result = await executor.executeStep({
      dryRun: false,
      runType: 'workflow',
      step: {
        id: 'step-1',
        executionRunId: 'run-1',
        tenantId: 'tenant-1',
        attemptCount: 0,
        stepType: 'HTTP',
        inputSnapshot: {},
      } as any,
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'CURL_REQUEST_REQUIRED');
  });
});
