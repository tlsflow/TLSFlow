import { afterEach, describe, expect, it, vi } from 'vitest'
import { disableUnifiedPluginVersion, enableUnifiedPluginVersion, listPluginCatalog, listPluginRuntimeMetrics, listUnifiedPluginVersions } from '@/api/modules/plugins.api'

describe('插件目录 API 合同', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('使用统一目录、固定版本和 Runner 指标路由', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { items: [], page: 1, pageSize: 20, total: 0 },
      requestId: 'req-plugin-contract',
      timestamp: '2026-08-09T00:00:00.000Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await listPluginCatalog()
    await listUnifiedPluginVersions()
    await listPluginRuntimeMetrics()

    expect(vi.mocked(fetch).mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/v1/plugin-catalog?page=1&pageSize=20',
      '/api/v1/plugin-versions?page=1&pageSize=20',
      '/api/v1/plugin-runtime/metrics?page=1&pageSize=20',
    ])
  })

  it('启用和禁用只传递固定 pluginVersionId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {},
      requestId: 'req-plugin-action',
      timestamp: '2026-08-09T00:00:00.000Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await enableUnifiedPluginVersion('plugin-version-1')
    await disableUnifiedPluginVersion('plugin-version-1')

    const bodies = vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)))
    expect(bodies).toEqual([{ pluginVersionId: 'plugin-version-1' }, { pluginVersionId: 'plugin-version-1' }])
    expect(bodies[0]).not.toHaveProperty('providerKey')
    expect(bodies[0]).not.toHaveProperty('supportedProducts')
    expect(bodies[0]).not.toHaveProperty('supportedOperations')
  })
})
