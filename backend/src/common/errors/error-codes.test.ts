import assert from 'node:assert/strict';
import test from 'node:test';
import { errorCodes } from './error-codes.js';

test('错误码目录不再维护宿主 Provider 错误码', () => {
  assert.deepEqual(Object.keys(errorCodes).filter((key) => key.includes('PROVIDER')), []);
  assert.ok(errorCodes.VALIDATION_FAILED);
  assert.ok(errorCodes.PLUGIN_RUNNER_PROTOCOL_VIOLATION);
  assert.ok(errorCodes.CA_OBSERVATION_SOURCE_UNAVAILABLE);
});
