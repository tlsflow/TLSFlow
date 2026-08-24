import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'

const pluginMocks = vi.hoisted(() => ({
  listPluginCatalog: vi.fn(),
  listUnifiedPluginVersions: vi.fn(),
  listPluginRuntimeMetrics: vi.fn(),
  refreshBuiltinPluginCatalog: vi.fn(),
  enableUnifiedPluginVersion: vi.fn(),
  disableUnifiedPluginVersion: vi.fn(),
  getUnifiedPluginUiResources: vi.fn(),
}))

vi.mock('@/api/modules/plugins.api', () => pluginMocks)

import PluginsView from '@/views/plugins/PluginsView.vue'

function page(items: readonly Record<string, unknown>[]) {
  return { data: { items, page: 1, pageSize: 500, total: items.length } }
}

function pluginRecord(index: number) {
  return {
    pluginVersionId: `version-${index}`,
    pluginId: `plugin-${index}`,
    version: `1.0.${index}`,
    source: index % 2 === 0 ? 'BUILTIN' : 'USER',
    status: 'DISABLED',
    name: `Plugin ${index}`,
    displayName: `Plugin ${index}`,
    description: `Description ${index}`,
    tags: ['network'],
    platforms: ['linux'],
    logoUrl: '',
    stepCount: 2,
    rollbackCount: 0,
    runtime: 'workflow_dsl',
    packageSha256: `package-${index}`,
    manifestSha256: `manifest-${index}`,
    resourceSha256: {},
    capabilities: [],
  }
}

describe('PluginsView', () => {
  it('保留筛选并提供客户端分页', async () => {
    const catalog = Array.from({ length: 13 }, (_, index) => pluginRecord(index))
    pluginMocks.listPluginCatalog.mockResolvedValue(page(catalog))
    pluginMocks.listUnifiedPluginVersions.mockResolvedValue(page(catalog.map((item) => ({
      id: item.pluginVersionId,
      pluginId: item.pluginId,
      version: item.version,
      updatedAt: '2026-08-11T00:00:00.000Z',
      manifest: { permissions: [] },
    }))))
    pluginMocks.listPluginRuntimeMetrics.mockResolvedValue(page([]))

    const wrapper = mount(PluginsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcModal: { template: '<div v-if="open"><slot /><slot name="actions" /></div>', props: ['open'] },
          GcEmptyState: { template: '<div><h2>{{ title }}</h2><p>{{ description }}</p><slot /></div>', props: ['title', 'description'] },
          GcPluginForm: { template: '<div />' },
          GcDevicePresentation: { template: '<div />' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.findAll('.plugin-card')).toHaveLength(12)
    expect(wrapper.find('.plugin-pagination').exists()).toBe(true)
    await wrapper.find('.plugin-pagination button:last-child').trigger('click')
    expect(wrapper.findAll('.plugin-card')).toHaveLength(1)

    const search = wrapper.find('input[type="search"]')
    await search.setValue('Plugin 12')
    expect(wrapper.findAll('.plugin-card')).toHaveLength(1)
    expect(wrapper.find('.plugin-card').text()).toContain('Plugin 12')
  })

  it('拒绝由插件元数据提供的跨域 Logo 地址', async () => {
    const catalog = [{ ...pluginRecord(1), logoUrl: 'https://untrusted.example/logo.svg' }]
    pluginMocks.listPluginCatalog.mockResolvedValue(page(catalog))
    pluginMocks.listUnifiedPluginVersions.mockResolvedValue(page([]))
    pluginMocks.listPluginRuntimeMetrics.mockResolvedValue(page([]))

    const wrapper = mount(PluginsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcModal: { template: '<div v-if="open"><slot /><slot name="actions" /></div>', props: ['open'] },
          GcEmptyState: { template: '<div><h2>{{ title }}</h2><p>{{ description }}</p><slot /></div>', props: ['title', 'description'] },
          GcPluginForm: { template: '<div />' },
          GcDevicePresentation: { template: '<div />' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('.plugin-logo img').exists()).toBe(false)
    expect(wrapper.find('.plugin-logo').text()).toContain('P')
  })

  it('对内置和未知能力使用无告警的本地化标签', async () => {
    const catalog = [{
      ...pluginRecord(1),
      capabilities: [
        { key: 'application.discover' },
        { key: 'plugin.custom.unknown' },
      ],
    }]
    pluginMocks.listPluginCatalog.mockResolvedValue(page(catalog))
    pluginMocks.listUnifiedPluginVersions.mockResolvedValue(page([]))
    pluginMocks.listPluginRuntimeMetrics.mockResolvedValue(page([]))

    const wrapper = mount(PluginsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcModal: { template: '<div v-if="open"><slot /><slot name="actions" /></div>', props: ['open'] },
          GcEmptyState: { template: '<div><h2>{{ title }}</h2><p>{{ description }}</p><slot /></div>', props: ['title', 'description'] },
          GcPluginForm: { template: '<div />' },
          GcDevicePresentation: { template: '<div />' },
        },
      },
    })
    await flushPromises()

    const text = wrapper.find('.plugin-card').text()
    expect(text).toContain('应用发现')
    expect(text).toContain('未知目录值：plugin.custom.unknown')
  })

  it('渲染仓库内置插件能力时不产生 Vue I18n 缺失告警', async () => {
    const catalog = [{
      ...pluginRecord(2),
      capabilities: [
        { key: 'application.discover' },
        { key: 'ca.account.manage' },
        { key: 'ca.order.manage' },
        { key: 'ca.challenge.orchestrate' },
        { key: 'ca.challenge.dns-solver' },
        { key: 'ca.certificate.issue' },
        { key: 'ca.certificate.renew' },
        { key: 'ca.certificate.revoke' },
        { key: 'cloud.service.connection-test' },
        { key: 'cloud.service.discover' },
      ],
    }]
    pluginMocks.listPluginCatalog.mockResolvedValue(page(catalog))
    pluginMocks.listUnifiedPluginVersions.mockResolvedValue(page([]))
    pluginMocks.listPluginRuntimeMetrics.mockResolvedValue(page([]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const wrapper = mount(PluginsView, {
        global: {
          plugins: [i18n],
          stubs: {
            GcModal: { template: '<div v-if="open"><slot /><slot name="actions" /></div>', props: ['open'] },
            GcEmptyState: { template: '<div><h2>{{ title }}</h2><p>{{ description }}</p><slot /></div>', props: ['title', 'description'] },
            GcPluginForm: { template: '<div />' },
            GcDevicePresentation: { template: '<div />' },
          },
        },
      })
      await flushPromises()

      expect(wrapper.find('.plugin-card').exists()).toBe(true)
      expect(warn.mock.calls.filter(([message]) => String(message).includes('[intlify]'))).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })
})
