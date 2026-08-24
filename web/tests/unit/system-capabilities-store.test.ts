import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getSystemHealth } from '@/api/modules/system.api'
import { useSystemCapabilitiesStore } from '@/stores/system-capabilities.store'

vi.mock('@/api/modules/system.api', () => ({
  getSystemHealth: vi.fn()
}))

describe('系统能力 Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('标准架构启用 Browser Runtime', async () => {
    vi.mocked(getSystemHealth).mockResolvedValue({
      data: {
        status: 'OK',
        service: 'gcac-backend',
        version: 'test',
        timestamp: new Date().toISOString(),
        deploymentArchitecture: 'standard',
        features: { browserRuntime: true }
      }
    } as never)
    const store = useSystemCapabilitiesStore()
    await store.load()
    expect(store.deploymentArchitecture).toBe('standard')
    expect(store.hasFeature('browser.runtime')).toBe(true)
  })

  it('小型架构和能力发现失败均关闭 Browser Runtime', async () => {
    vi.mocked(getSystemHealth).mockResolvedValueOnce({
      data: {
        status: 'OK',
        service: 'gcac-backend',
        version: 'test',
        timestamp: new Date().toISOString(),
        deploymentArchitecture: 'small',
        features: { browserRuntime: false }
      }
    } as never)
    const store = useSystemCapabilitiesStore()
    await store.load()
    expect(store.hasFeature('browser.runtime')).toBe(false)

    vi.mocked(getSystemHealth).mockRejectedValueOnce(new Error('health unavailable'))
    await expect(store.load(true)).rejects.toThrow('health unavailable')
    expect(store.deploymentArchitecture).toBeNull()
    expect(store.hasFeature('browser.runtime')).toBe(false)
  })
})
