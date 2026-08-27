import assert from 'node:assert/strict';
import test from 'node:test';
import { CaOperationsRealtimeStreamService } from './ca-operations-realtime.js';

test('CA 实时流只广播标准化后的变更范围，并支持取消订阅', () => {
  const stream = new CaOperationsRealtimeStreamService();
  const messages: Array<{ tenantId: string; providerId: string; caId: string; objectTypes: readonly string[] }> = [];
  const unsubscribe = stream.subscribe((message) => messages.push(message));

  stream.publishChanged({
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    caId: 'ca-1',
    objectTypes: ['request', 'request', ''],
  });
  assert.deepEqual(messages, [{
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    caId: 'ca-1',
    objectTypes: ['request'],
  }]);

  unsubscribe();
  stream.publishChanged({
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    caId: 'ca-1',
    objectTypes: ['issuance'],
  });
  assert.equal(messages.length, 1);
});
