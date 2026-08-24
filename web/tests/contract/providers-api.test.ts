import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCloudAccountAsset,
  deleteCloudAccountAsset,
  listCloudAccountAssets,
  updateCloudAccountAsset,
} from '@/api/modules/providers.api'

function mockResponse(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: { items: [], page: 1, pageSize: 20, total: 0 },
    requestId: 'req_provider_contract',
    timestamp: '2026-08-06T00:00:00.000Z',
  }), { status: 200 })))
}

describe('云服务 API modules', () => {
  afterEach(() => vi.restoreAllMocks())

  it('云账号 CRUD 只访问资源接口，不暴露旧 Provider Action', async () => {
    mockResponse()
    await listCloudAccountAssets()
    await createCloudAccountAsset({ displayName: '阿里云生产账号', providerKey: 'cloud.aliyun' })
    await updateCloudAccountAsset({ id: 'asset-1', displayName: '阿里云生产账号' })
    await deleteCloudAccountAsset('asset-1')

    const calls = vi.mocked(fetch).mock.calls
    const urls = calls.map((call) => String(call[0]))
    expect(urls).toEqual([
      '/api/v1/cloud-account-assets',
      '/api/v1/cloud-account-assets',
      '/api/v1/cloud-account-assets',
      '/api/v1/cloud-account-assets/delete',
    ])
    expect(calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? 'GET')).toEqual([
      'GET',
      'POST',
      'PATCH',
      'POST',
    ])
    expect(urls.some((url) => url.includes('/api/api/'))).toBe(false)
    expect(urls.some((url) => /connection-test|discover|execute|capabilities/.test(url))).toBe(false)
  })
})
