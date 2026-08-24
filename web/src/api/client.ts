import type { ApiResult } from './generated/client-types'

export interface ApiClientOptions {
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly getToken?: () => string | null
  readonly getRequestContext?: () => ApiRequestContext | null
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  readonly body?: unknown
  readonly idempotencyKey?: string
  readonly timeoutMs?: number
  readonly publicBaseUrl?: string
  readonly accept?: string
}

export interface ApiRequestContext {
  readonly actorId?: string | null
  readonly actorType?: string | null
  readonly tenantId?: string | null
}

export class ApiClientError extends Error {
  readonly errorCode: string
  readonly requestId: string
  readonly status: number

  constructor(message: string, options: { errorCode: string; requestId: string; status: number }) {
    super(message)
    this.name = 'ApiClientError'
    this.errorCode = options.errorCode
    this.requestId = options.requestId
    this.status = options.status
  }
}

export function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function createIdempotencyKey(prefix = 'idem'): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)}`
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly getToken?: () => string | null
  private readonly getRequestContext?: () => ApiRequestContext | null

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api'
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.getToken = options.getToken
    this.getRequestContext = options.getRequestContext
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
    const requestId = createRequestId()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs)
    const headers = new Headers(options.headers)
    headers.set('Accept', options.accept ?? 'application/json')
    headers.set('X-Request-Id', requestId)

    const token = this.getToken?.()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    const requestContext = this.getRequestContext?.()
    if (requestContext?.actorId) {
      headers.set('X-Actor-Id', requestContext.actorId)
      headers.set('X-Actor-Type', requestContext.actorType ?? 'user')
    }
    if (requestContext?.tenantId) {
      headers.set('X-Tenant-Id', requestContext.tenantId)
    }
    if (options.idempotencyKey) {
      headers.set('X-Idempotency-Key', options.idempotencyKey)
    }
    if (options.publicBaseUrl) {
      headers.set('X-Public-Base-Url', options.publicBaseUrl)
    }

    const body = this.encodeBody(options.body, headers)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        body,
        signal: controller.signal
      })
      return await this.parseResponse<T>(response, requestId)
    } finally {
      clearTimeout(timeout)
    }
  }

  get<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.request<T>(path, { ...options, method: 'GET' })
  }

  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body })
  }

  async download(path: string, options: ApiRequestOptions = {}): Promise<Response> {
    const requestId = createRequestId()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs)
    const headers = new Headers(options.headers)
    headers.set('Accept', options.accept ?? '*/*')
    headers.set('X-Request-Id', requestId)

    const token = this.getToken?.()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    const requestContext = this.getRequestContext?.()
    if (requestContext?.actorId) {
      headers.set('X-Actor-Id', requestContext.actorId)
      headers.set('X-Actor-Type', requestContext.actorType ?? 'user')
    }
    if (requestContext?.tenantId) {
      headers.set('X-Tenant-Id', requestContext.tenantId)
    }
    if (options.idempotencyKey) {
      headers.set('X-Idempotency-Key', options.idempotencyKey)
    }
    if (options.publicBaseUrl) {
      headers.set('X-Public-Base-Url', options.publicBaseUrl)
    }

    const body = this.encodeBody(options.body, headers)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        body,
        signal: controller.signal
      })
      if (!response.ok) {
        await this.parseResponse(response, requestId)
      }
      return response
    } finally {
      clearTimeout(timeout)
    }
  }

  private encodeBody(body: unknown, headers: Headers): BodyInit | undefined {
    if (body === undefined || body === null) return undefined
    if (body instanceof FormData) return body
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    return JSON.stringify(body)
  }

  private async parseResponse<T>(response: Response, fallbackRequestId: string): Promise<ApiResult<T>> {
    const text = await response.text()
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    const requestId = parsed.requestId ?? response.headers.get('X-Request-Id') ?? fallbackRequestId
    const timestamp = parsed.timestamp ?? new Date().toISOString()

    if (!response.ok) {
      throw new ApiClientError(typeof parsed.message === 'string' ? parsed.message : '请求失败', {
        errorCode: typeof parsed.errorCode === 'string' ? parsed.errorCode : `HTTP_${response.status}`,
        requestId: String(requestId),
        status: response.status
      })
    }

    const hasWrappedData = Object.prototype.hasOwnProperty.call(parsed, 'data')
    return {
      ...(hasWrappedData ? parsed : { data: parsed as T }),
      requestId: String(requestId),
      timestamp: String(timestamp)
    } as ApiResult<T>
  }
}

let apiRequestContextProvider: (() => ApiRequestContext | null) | undefined
let apiTokenProvider: (() => string | null) | undefined

export function setApiRequestContextProvider(provider: (() => ApiRequestContext | null) | undefined): void {
  apiRequestContextProvider = provider
}

export function setApiTokenProvider(provider: (() => string | null) | undefined): void {
  apiTokenProvider = provider
}

export function readApiRequestContext(): ApiRequestContext | null {
  return apiRequestContextProvider?.() ?? null
}

export function readApiToken(): string | null {
  return apiTokenProvider?.() ?? null
}

export const apiClient = new ApiClient({
  getToken: () => apiTokenProvider?.() ?? null,
  getRequestContext: () => apiRequestContextProvider?.() ?? null
})
