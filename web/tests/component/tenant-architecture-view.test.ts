import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { usePermissionStore } from '@/stores/permission.store'
import { useTenantStore } from '@/stores/tenant.store'

const apiMocks = vi.hoisted(() => ({
  createTenant: vi.fn(),
  createTenantMembership: vi.fn(),
  enableTenantMode: vi.fn(),
  getTenantArchitecture: vi.fn(),
  getTenantModeSummary: vi.fn(),
  rollbackTenantMode: vi.fn(),
  runTenantModePreflight: vi.fn(),
  updateTenantStatus: vi.fn(),
}))

vi.mock('@/api/modules/security.api', () => apiMocks)

import TenantArchitectureView from '@/views/settings/TenantArchitectureView.vue'

describe('TenantArchitectureView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    usePermissionStore().setPermissions(['settings.read', 'tenant.manage', 'tenant.mode.manage'])
    useTenantStore().$patch({ currentTenantId: 'group-1', mode: 'single' })
  })

  it('single 模式不请求也不渲染集团树、子公司或租户切换信息', async () => {
    apiMocks.getTenantModeSummary.mockResolvedValue({ data: { state: { mode: 'single', lifecycleState: 'SINGLE', updatedAt: '2026-08-14T00:00:00.000Z' } } })

    const wrapper = mount(TenantArchitectureView, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(apiMocks.getTenantArchitecture).not.toHaveBeenCalled()
    expect(wrapper.find('.tenant-architecture-page__tree').exists()).toBe(false)
    expect(wrapper.find('.tenant-architecture-page__forms').exists()).toBe(false)
    expect(wrapper.text()).toContain('已关闭')
  })

  it('hierarchical 模式从聚合接口渲染集团与子公司节点', async () => {
    apiMocks.getTenantModeSummary.mockResolvedValue({ data: {
      state: { mode: 'hierarchical', lifecycleState: 'HIERARCHICAL', updatedAt: '2026-08-14T00:00:00.000Z' },
      lastEnableBatch: { id: 'enable-1', kind: 'ENABLE', status: 'COMPLETED', startedAt: '2026-08-14T00:00:00.000Z' },
    } })
    apiMocks.getTenantArchitecture.mockResolvedValue({ data: {
      mode: 'hierarchical', currentTenantId: 'company-1', contextVersion: 'context-2', roots: [{
        id: 'group-1', name: '集团', code: 'group', type: 'GROUP', status: 'ACTIVE', current: false, administrators: [], children: [{
          id: 'company-1', name: '子公司', code: 'company', type: 'COMPANY', parentId: 'group-1', status: 'ACTIVE', current: true, administrators: [], children: [],
        }],
      }],
    } })

    const wrapper = mount(TenantArchitectureView, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(apiMocks.getTenantArchitecture).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.tenant-architecture-page__tree').text()).toContain('集团')
    expect(wrapper.find('.tenant-architecture-page__tree').text()).toContain('子公司')
    expect(wrapper.find('.tenant-architecture-page__child').text()).toContain('正常')
    expect(wrapper.find('.tenant-architecture-page__child').text()).toContain('当前')
    expect(wrapper.find('.tenant-architecture-page__history').text()).toContain('最近模式记录')
    expect(wrapper.find('.tenant-architecture-page__history').text()).toContain('启用')
    expect(useTenantStore().contextVersion).toBe('context-2')
  })

  it('预检查按满足项和阻断项使用不同的语义状态展示', async () => {
    apiMocks.getTenantModeSummary.mockResolvedValue({ data: { state: { mode: 'single', lifecycleState: 'SINGLE', updatedAt: '2026-08-14T00:00:00.000Z' } } })
    apiMocks.runTenantModePreflight.mockResolvedValue({ data: {
      batch: { id: 'preflight-1' },
      report: {
        blockers: 1,
        items: [
          { id: 'root', title: '默认根租户', message: '根租户有效。', status: 'passed' },
          { id: 'legacy', title: '历史租户标识归一化', message: '仍有历史记录需要处理。', status: 'blocked' },
        ],
      },
    } })

    const wrapper = mount(TenantArchitectureView, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.get('.tenant-architecture-page__mode-actions button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tenant-architecture-page__preflight--blocked').exists()).toBe(true)
    expect(wrapper.find('.tenant-architecture-page__preflight-result--passed').text()).toContain('默认根租户')
    expect(wrapper.find('.tenant-architecture-page__preflight-result--blocked').text()).toContain('历史租户标识归一化')
    expect(wrapper.find('.tenant-architecture-page__preflight-result--blocked').text()).toContain('请先解决以下问题')
    expect(wrapper.find('.tenant-architecture-page__preflight-marker--passed').text()).toBe('✅')
    expect(wrapper.find('.tenant-architecture-page__preflight-marker--blocked').text()).toBe('❌')
    expect(wrapper.find('.gc-form-success').exists()).toBe(false)
    expect(wrapper.find('.gc-form-error').text()).toContain('请先解决以下问题')
  })
})
