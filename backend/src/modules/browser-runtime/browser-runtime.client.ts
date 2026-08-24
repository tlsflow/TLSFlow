import { AppError } from '../../common/errors/app-error.js';
import type {
  BrowserRuntimeActionResult,
  BrowserRuntimeBrowserAction,
  BrowserRuntimeCreateRequest,
  BrowserRuntimeSession,
} from './browser-runtime.types.js';

export interface BrowserRuntimeClientOptions {
  baseUrl?: string;
  sharedSecret?: string;
  fetchImpl?: typeof fetch;
}

export class BrowserRuntimeClient {
  private readonly baseUrl: string;
  private readonly sharedSecret?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BrowserRuntimeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.BROWSER_RUNTIME_URL ?? '').replace(/\/+$/, '');
    this.sharedSecret = options.sharedSecret ?? process.env.BROWSER_RUNTIME_SHARED_SECRET;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async createSession(input: BrowserRuntimeCreateRequest): Promise<BrowserRuntimeSession> {
    return this.request<BrowserRuntimeSession>('/v1/sessions', {
      method: 'POST',
      body: input,
      idempotencyKey: input.sessionId,
    });
  }

  async getSession(sessionId: string): Promise<BrowserRuntimeSession> {
    return this.request<BrowserRuntimeSession>(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
  }

  async execute(sessionId: string, action: BrowserRuntimeBrowserAction): Promise<BrowserRuntimeActionResult> {
    return this.request<BrowserRuntimeActionResult>(`/v1/sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: 'POST',
      body: action,
    });
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }

  private async request<T = unknown>(
    path: string,
    options: { method: string; body?: unknown; idempotencyKey?: string },
  ): Promise<T> {
    if (!this.baseUrl) throw new AppError('BROWSER_RUNTIME_UNAVAILABLE', 'Browser Runtime Service 未配置');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.sharedSecret ? { 'x-browser-runtime-secret': this.sharedSecret } : {}),
          ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new AppError('BROWSER_RUNTIME_UNAVAILABLE', 'Browser Runtime Service 不可达', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const payload = await readPayload(response);
    if (!response.ok) {
      const record = asRecord(payload);
      throw new AppError(
        typeof record?.errorCode === 'string' ? record.errorCode as never : 'BROWSER_RUNTIME_UNAVAILABLE',
        typeof record?.errorMessage === 'string' ? record.errorMessage : 'Browser Runtime Service 请求失败',
        record,
      );
    }
    return payload as T;
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { body: text };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
