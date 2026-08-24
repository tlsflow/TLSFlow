import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const GcPluginFormStub = defineComponent({
  name: 'GcPluginForm',
  props: { schema: { type: Object, required: true } },
  template: '<div class="plugin-form">{{ schema.sections.length }}</div>',
})

describe('DeviceOnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    pluginMocks.listPluginCatalog.mockResolvedValue(response({ items: [] }))
    pluginMocks.getUnifiedPluginUiResources.mockResolvedValue(response({ forms: {}, locale: { messages: {} } }))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
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

    const wrapper = mount(DeviceOnboardingWizard, {
      props: { open: true, initialSelection: { kind: 'AGENT_INSTALL', platformKey: 'linux' } },
      global: { plugins: [i18n], stubs: { Teleport: true, GcPluginForm: GcPluginFormStub } },
    })
    await flushPromises()

    expect(deviceMocks.onboardManagedDevice).toHaveBeenCalledWith({ platformKey: 'linux-red-hat' })
    wrapper.unmount()
  })

  it('将 Linux 发行版入口放入 Agent 分组并使用对应 Logo', async () => {
    deviceMocks.listDeviceOnboardingPlatforms.mockResolvedValue(response([{
      key: 'linux-red-hat', displayNameKey: 'devices.platforms.linuxRedHat', productFamily: 'Linux Server', managementMethod: 'AGENT',
      supportDescriptionKey: 'devices.platforms.linuxRedHatDescription',
      group: 'AGENT', onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }, {
      key: 'linux-debian-ubuntu', displayNameKey: 'devices.platforms.linuxDebianUbuntu', productFamily: 'Linux Server', managementMethod: 'AGENT',
      supportDescriptionKey: 'devices.platforms.linuxDebianUbuntuDescription',
      group: 'AGENT', onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }, {
      key: 'linux-kylin', displayNameKey: 'devices.platforms.linuxKylin', productFamily: 'Linux Server', managementMethod: 'AGENT',
      supportDescriptionKey: 'devices.platforms.linuxKylinDescription',
      group: 'AGENT', onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }, {
      key: 'linux-uos', displayNameKey: 'devices.platforms.linuxUos', productFamily: 'Linux Server', managementMethod: 'AGENT',
      supportDescriptionKey: 'devices.platforms.linuxUosDescription',
      group: 'AGENT', onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }]))

    const wrapper = mount(DeviceOnboardingWizard, {
      props: { open: true },
      global: { plugins: [i18n], stubs: { Teleport: true, GcPluginForm: GcPluginFormStub } },
    })
    await flushPromises()

    expect(wrapper.findAll('.device-wizard__platform-group')).toHaveLength(1)
    expect(wrapper.find('.device-wizard__platform-group h3').text()).toBe('Agent')
    expect(wrapper.text()).toContain('Red Hat 系列')
    expect(wrapper.text()).toContain('Debian/Ubuntu 系列')
    expect(wrapper.text()).toContain('麒麟系列')
    expect(wrapper.text()).toContain('统信 OS 系列')
    expect(wrapper.text()).toContain('RHEL/CentOS 7-9、Rocky/AlmaLinux 8-9；Linux 内核 3.2 及以上')
    expect(wrapper.text()).toContain('银河麒麟 V10-V11')
    expect(wrapper.text()).toContain('统信 UOS 20-25')
    expect(wrapper.text()).not.toContain('银河麒麟 V10-V11；Linux 内核 3.2 及以上')
    expect(wrapper.text()).not.toContain('统信 UOS 20-25；Linux 内核 3.2 及以上')
    expect(wrapper.find('img[src="/platform-logos/red-hat.svg"]').exists()).toBe(true)
    expect(wrapper.find('img[src="/platform-logos/debian.svg"]').exists()).toBe(true)
    expect(wrapper.find('img[src="/platform-logos/kylin.svg"]').exists()).toBe(true)
    expect(wrapper.find('img[src="/platform-logos/uos.svg"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('应用声明多个 Agent 平台时只显示这些平台并要求用户选择', async () => {
    deviceMocks.listDeviceOnboardingPlatforms.mockResolvedValue(response([{
      key: 'linux', displayNameKey: 'devices.platforms.linux', productFamily: 'Linux Server', managementMethod: 'AGENT',
      group: 'AGENT', onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }, {
      key: 'windows-server-2016-plus', displayNameKey: 'devices.platforms.windowsServer2016Plus', productFamily: 'Windows Server', managementMethod: 'AGENT',
      group: 'AGENT', onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }, {
      key: 'windows-server-2008-r2', displayNameKey: 'devices.platforms.windowsServer2008R2', productFamily: 'Windows Server', managementMethod: 'AGENT',
      group: 'AGENT', onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }]))
    deviceMocks.onboardManagedDevice.mockResolvedValue(response({ installSession: { installCommand: 'install-windows-agent' } }))

    const wrapper = mount(DeviceOnboardingWizard, {
      props: {
        open: true,
        initialSelection: { kind: 'AGENT_INSTALL', platformKeys: ['linux', 'windows-server-2016-plus'] },
      },
      global: { plugins: [i18n], stubs: { Teleport: true, GcPluginForm: GcPluginFormStub } },
    })
    await flushPromises()
    const platformButtons = () => wrapper.findAll<HTMLButtonElement>('.device-wizard__platform')
    expect(platformButtons()).toHaveLength(2)
    expect(wrapper.text()).toContain('Linux')
    expect(wrapper.text()).toContain('Windows Server 2016+')
    expect(wrapper.text()).not.toContain('Windows Server 2008 R2')
    expect(deviceMocks.onboardManagedDevice).not.toHaveBeenCalled()

    const windowsButton = platformButtons().find((button) => button.text().includes('Windows Server 2016+'))
    expect(windowsButton).toBeDefined()
    await windowsButton!.trigger('click')
    await flushPromises()
    expect(deviceMocks.onboardManagedDevice).toHaveBeenCalledWith({ platformKey: 'windows-server-2016-plus' })
    wrapper.unmount()
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
      global: { plugins: [i18n], stubs: { Teleport: true, GcPluginForm: GcPluginFormStub } },
    })
    await flushPromises()
    expect(pluginMocks.getUnifiedPluginUiResources).toHaveBeenCalledWith('plugin-version-citrix', expect.any(String))
    expect(wrapper.find('.plugin-form').exists()).toBe(true)
    wrapper.unmount()
  })
})
