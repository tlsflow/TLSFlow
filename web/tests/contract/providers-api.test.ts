import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCloudAccountAsset,
  deleteCloudAccountAsset,
  discoverCloudAccountAsset,
  executeProviderCapability,
  listCloudAccountAssets,
  listProviderCapabilities,
  listProviders,
  testCloudAccountAsset,
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

  it('所有云服务请求都使用单层 /api/v1 路径', async () => {
    mockResponse()
    await listProviders()
    await listProviderCapabilities()
    await listCloudAccountAssets()
    await createCloudAccountAsset({ displayName: '阿里云生产账号' })
    await updateCloudAccountAsset({ id: 'asset-1', displayName: '阿里云生产账号' })
    await deleteCloudAccountAsset('asset-1')
    await testCloudAccountAsset('asset-1')
    await discoverCloudAccountAsset('asset-1')
    await executeProviderCapability('asset-1', {
      frameworkType: 'cloud.aliyun.cdn',
      operationKey: 'certificate.deploy',
      target: {},
    })

    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual([
      '/api/v1/providers',
      '/api/v1/provider-capability-plugins',
      '/api/v1/cloud-account-assets',
      '/api/v1/cloud-account-assets',
      '/api/v1/cloud-account-assets',
      '/api/v1/cloud-account-assets/delete',
      '/api/v1/cloud-account-assets/asset-1/connection-test',
      '/api/v1/cloud-account-assets/asset-1/discover',
      '/api/v1/cloud-account-assets/asset-1/execute',
    ])
    expect(urls.some((url) => url.includes('/api/api/'))).toBe(false)
  })
})
