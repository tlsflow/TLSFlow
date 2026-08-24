import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'

const deviceMocks = vi.hoisted(() => ({
  listDeviceOnboardingPlatforms: vi.fn(),
  onboardManagedDevice: vi.fn(),
}))
const pluginMocks = vi.hoisted(() => ({
  getUnifiedPluginUiResources: vi.fn(),
  listPluginCatalog: vi.fn(),
}))

vi.mock('@/api/modules/devices.api', () => deviceMocks)
vi.mock('@/api/modules/plugins.api', () => pluginMocks)

import DeviceOnboardingWizard from '@/views/devices/DeviceOnboardingWizard.vue'

function response(data: unknown) {
  return { data }
}

const GcModalStub = defineComponent({
  name: 'GcModal',
  props: { open: { type: Boolean, default: false } },
  template: '<div v-if="open"><slot /><slot name="actions" /></div>',
})
const GcPluginFormStub = defineComponent({
  name: 'GcPluginForm',
  props: { schema: { type: Object, required: true } },
  template: '<div class="plugin-form">{{ schema.sections.length }}</div>',
})

describe('DeviceOnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pluginMocks.listPluginCatalog.mockResolvedValue(response({ items: [] }))
    pluginMocks.getUnifiedPluginUiResources.mockResolvedValue(response({ forms: {}, locale: { messages: {} } }))
  })

  it('按应用插件声明直接进入对应的 Agent 安装流程', async () => {
    deviceMocks.listDeviceOnboardingPlatforms.mockResolvedValue(response([{
      key: 'linux',
      displayNameKey: 'devices.onboarding.platforms.linux',
      productFamily: 'linux',
      managementMethod: 'AGENT',
      group: 'OTHER',
      onboardingKind: 'AGENT_INSTALL',
      supportStatus: 'SUPPORTED',
      formSchema: [],
    }]))
    deviceMocks.onboardManagedDevice.mockResolvedValue(response({ installSession: { installCommand: 'install-linux-agent', expiresAt: '2026-08-14T12:00:00.000Z' } }))

    mount(DeviceOnboardingWizard, {
      props: { open: true, initialSelection: { kind: 'AGENT_INSTALL', platformKey: 'linux' } },
      global: { plugins: [i18n], stubs: { GcModal: GcModalStub, GcPluginForm: GcPluginFormStub } },
    })
    await flushPromises()

    expect(deviceMocks.onboardManagedDevice).toHaveBeenCalledWith({ platformKey: 'linux' })
  })

  it('按应用插件声明直接加载对应设备插件的表单', async () => {
    deviceMocks.listDeviceOnboardingPlatforms.mockResolvedValue(response([]))
    pluginMocks.listPluginCatalog.mockResolvedValue(response({
      items: [{
        id: 'plugin-version-citrix',
        pluginVersionId: 'plugin-version-citrix',
        pluginId: 'device.citrix.netscaler-adc',
        catalogType: 'UNIFIED_PLUGIN',
        status: 'ENABLED',
        runtime: 'WORKFLOW_DSL',
        scope: 'BOTH',
        capabilities: [{ key: 'device.connection.test' }, { key: 'device.discover' }],
      }],
    }))
    pluginMocks.getUnifiedPluginUiResources.mockResolvedValue(response({
      forms: { device: { sections: [{ fields: [] }] } },
      locale: { messages: { 'plugin.citrixAdc.name': 'Citrix ADC' } },
    }))

    const wrapper = mount(DeviceOnboardingWizard, {
      props: { open: true, initialSelection: { kind: 'PLUGIN_MANAGED', pluginId: 'device.citrix.netscaler-adc' } },
      global: { plugins: [i18n], stubs: { GcModal: GcModalStub, GcPluginForm: GcPluginFormStub } },
    })
    await flushPromises()

    expect(pluginMocks.getUnifiedPluginUiResources).toHaveBeenCalledWith('plugin-version-citrix', expect.any(String))
    expect(wrapper.find('.plugin-form').exists()).toBe(true)
  })
})
