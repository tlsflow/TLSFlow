import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { ProviderAsyncWaiter } from './provider-async-waiter.js';

test('Provider AsyncWaiter 等待成功状态并限制轮询次数', async () => {
  const waiter = new ProviderAsyncWaiter();
  let reads = 0;
  const result = await waiter.wait({
    providerKey: 'cloud.tencent',
    operationId: 'task-1',
    timeoutMs: 100,
    pollIntervalMs: 0,
    readState: async () => {
      reads += 1;
      return reads < 3 ? { status: 'RUNNING' } : { status: 'SUCCEEDED', detail: { taskId: 'task-1' } };
    },
    delay: async () => undefined,
  });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(reads, 3);
});

test('Provider AsyncWaiter 超时映射为 PROVIDER_ASYNC_TIMEOUT', async () => {
  const waiter = new ProviderAsyncWaiter();
  await assert.rejects(
    () => waiter.wait({
      providerKey: 'cloud.tencent',
      operationId: 'task-timeout',
      timeoutMs: 1,
      pollIntervalMs: 0,
      readState: async () => ({ status: 'RUNNING' }),
      delay: async () => undefined,
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PROVIDER_ASYNC_TIMEOUT',
  );
});

test('Provider AsyncWaiter 尊重取消信号', async () => {
  const waiter = new ProviderAsyncWaiter();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => waiter.wait({
      providerKey: 'cloud.tencent',
      operationId: 'task-cancelled',
      timeoutMs: 100,
      pollIntervalMs: 0,
      signal: controller.signal,
      readState: async () => ({ status: 'RUNNING' }),
      delay: async () => undefined,
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PROVIDER_OPERATION_UNSUPPORTED',
  );
});
