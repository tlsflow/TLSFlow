import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, createIdempotencyKey } from '@/api/client'
import { apiContractMetadata } from '@/api/generated/client-types'
import { apiOperations, type ApiPath } from '@/api/generated/paths'

describe('API Client 契约', () => {
  afterEach(() => vi.restoreAllMocks())

  it('使用后端 OpenAPI 生成的路径元数据', () => {
    const healthPath: ApiPath = '/api/v1/health'
    expect(healthPath).toBe('/api/v1/health')
    expect(apiContractMetadata.paths).toContain('/api/v1/health')
    expect(apiOperations.map((operation) => operation.operationId)).toContain('getHealth')
  })

  it('解析统一成功响应并保留 requestId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { ok: true }, requestId: 'req_1', timestamp: '2026-06-08T00:00:00.000Z' }), { status: 200 })))
    const client = new ApiClient({ baseUrl: 'https://api.example.test' })
    await expect(client.get('/health')).resolves.toMatchObject({ requestId: 'req_1', data: { ok: true } })
  })

  it('请求会携带 actor 和 tenant 上下文头', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { ok: true }, requestId: 'req_ctx', timestamp: '2026-06-08T00:00:00.000Z' }), { status: 200 })))
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      getRequestContext: () => ({ actorId: 'user_1', actorType: 'user', tenantId: 'tenant_1' })
    })

    await client.get('/health')

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('X-Actor-Id')).toBe('user_1')
    expect(headers.get('X-Actor-Type')).toBe('user')
    expect(headers.get('X-Tenant-Id')).toBe('tenant_1')
  })

  it('错误响应抛出包含错误码和 requestId 的异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errorCode: 'PERMISSION_DENIED', message: '无权限', requestId: 'req_2', timestamp: '2026-06-08T00:00:00.000Z' }), { status: 403 })))
    const client = new ApiClient({ baseUrl: 'https://api.example.test' })
    await expect(client.get('/secret')).rejects.toMatchObject({ errorCode: 'PERMISSION_DENIED', requestId: 'req_2', status: 403 })
  })

  it('高风险操作可生成幂等键', () => {
    expect(createIdempotencyKey('deploy')).toMatch(/^deploy_/)
  })
})
