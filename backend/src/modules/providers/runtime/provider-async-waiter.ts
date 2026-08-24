import { AppError } from '../../../common/errors/app-error.js';

export type ProviderAsyncStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface ProviderAsyncState {
  status: ProviderAsyncStatus;
  detail?: Record<string, unknown>;
}

export interface ProviderAsyncWaiterInput {
  providerKey: string;
  operationId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
  readState(): Promise<ProviderAsyncState>;
  delay?(milliseconds: number): Promise<void>;
}

/**
 * Provider 异步任务的统一等待器。
 *
 * 厂商只需要提供“如何读取状态”，轮询、超时、取消和错误分类由宿主统一处理。
 * 这样不会让每个云厂商重复实现一套容易出错的 while 循环。
 */
export class ProviderAsyncWaiter {
  async wait(input: ProviderAsyncWaiterInput): Promise<ProviderAsyncState> {
    const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));
    const pollIntervalMs = Math.max(0, Math.floor(input.pollIntervalMs));
    const delay = input.delay ?? defaultDelay;
    const startedAt = Date.now();

    while (true) {
      if (input.signal?.aborted) {
        throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 异步操作已取消', {
          providerKey: input.providerKey,
          operationId: input.operationId,
        });
      }
      const state = await input.readState();
      if (state.status === 'SUCCEEDED') return state;
      if (state.status === 'FAILED') {
        throw new AppError('PROVIDER_REQUEST_FAILED', 'Provider 异步操作失败', {
          providerKey: input.providerKey,
          operationId: input.operationId,
          ...(state.detail ?? {}),
        });
      }
      if (state.status === 'CANCELLED') {
        throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 异步操作已取消', {
          providerKey: input.providerKey,
          operationId: input.operationId,
          ...(state.detail ?? {}),
        });
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new AppError('PROVIDER_ASYNC_TIMEOUT', 'Provider 异步操作超时', {
          providerKey: input.providerKey,
          operationId: input.operationId,
          timeoutMs,
        });
      }
      await delay(Math.min(pollIntervalMs, Math.max(0, timeoutMs - (Date.now() - startedAt))));
    }
  }
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
