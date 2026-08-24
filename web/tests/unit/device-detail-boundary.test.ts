import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DeviceDetailAdapterRegistry } from '../../src/views/devices/details/device-detail.adapter'
import { DeviceDetailTabRegistry } from '../../src/views/devices/details/device-detail.registry'
import { deviceDetailTabRegistry } from '../../src/views/devices/details/device-detail.providers'

function visibleActions(detail: Record<string, unknown>): string[] {
  return Array.isArray(detail.allowedActions) ? detail.allowedActions.map(String) : []
}

describe('统一设备详情动作边界', () => {
  it('Agent 与网络设备动作不串线', () => {
    const agent = visibleActions({ extensionType: 'AGENT', allowedActions: ['UPGRADE_AGENT', 'DISABLE_DEVICE'] })
    const adc = visibleActions({ extensionType: 'NETWORK_APPLIANCE', allowedActions: ['TEST_CONNECTION', 'REFRESH_DISCOVERY', 'DISABLE_DEVICE'] })
    expect(agent).toContain('UPGRADE_AGENT')
    expect(agent).not.toContain('TEST_CONNECTION')
    expect(adc).toContain('TEST_CONNECTION')
    expect(adc).not.toContain('UPGRADE_AGENT')
  })

  it('统一详情保留不同类型的扩展标识', () => {
    const agent = { extensionType: 'AGENT', extensionSummary: { agentId: 'agent_1' } }
    const adc = { extensionType: 'NETWORK_APPLIANCE', extensionSummary: { deviceAssetId: 'device_1', deviceFamily: 'NETSCALER_ADC' } }
    expect((agent.extensionSummary as Record<string, unknown>).agentId).toBe('agent_1')
    expect((adc.extensionSummary as Record<string, unknown>).deviceAssetId).toBe('device_1')
  })

  it('未知设备回退到通用 Adapter', () => {
    const context = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [{ key: 'common', fields: [{ key: 'status', value: 'UNKNOWN', valueType: 'STATUS' }] }],
      sites: [],
      certificates: [{
        id: 'cert_1',
        certificateAssetId: 'asset_1',
        certificateVersionId: 'version_1',
        fingerprintSha256: 'a'.repeat(64),
      }],
      logs: [],
      allowedActions: ['VIEW_RUNTIME'],
    })
    expect(context.overviewSections[0]?.key).toBe('common')
    expect(context.permissions.has('VIEW_RUNTIME')).toBe(true)
    expect(context.certificates[0]?.certificateAssetId).toBe('asset_1')
    expect(context.certificates[0]?.certificateVersionId).toBe('version_1')
  })

  it('站点绑定证书可使用指纹作为稳定身份', () => {
    const context = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      sites: [{
        id: 'site_iis',
        siteAssetId: 'site_iis',
        kind: 'IIS',
        name: 'test08',
        bindings: [{
          id: 'binding_https',
          bindingKey: '*:443:',
          bindingType: 'IIS_BINDING',
          status: 'Started',
          certificate: {
            subject: 'CN=Ser08-TEST',
            fingerprintSha256: 'd68b757dd503f25d3621249653832df563ff33323c5284c43ddb124bbd4858cd',
          },
          replacement: { allowed: false },
        }],
        metadata: {},
      }],
      certificates: [],
      logs: [],
    })
    expect(context.sites[0]?.bindings[0]?.certificate?.subject).toBe('CN=Ser08-TEST')
  })

  it('标签按数据可见性、顺序和 key 去重', () => {
    const component = defineComponent({ template: '<div />' })
    const context = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      sites: [{ id: 'site_1', siteAssetId: 'site_1', kind: 'IIS', name: 'Default', bindings: [], metadata: {} }],
      certificates: [],
      logs: [],
    })
    const registry = new DeviceDetailTabRegistry([{
      key: 'sites',
      supports: () => true,
      getTabs: () => [{ key: 'iis', labelKey: 'devices.detail.tabs.iis', order: 300, component, isVisible: current => current.sites.some(site => site.kind === 'IIS') }],
    }, {
      key: 'duplicate',
      supports: () => true,
      getTabs: () => [{ key: 'iis', labelKey: 'devices.detail.tabs.iis', order: 400, component, isVisible: () => true }],
    }])
    expect(registry.resolve(context).map(tab => tab.key)).toEqual(['iis'])
  })

  it('默认标签始终显示且站点标签由实际记录决定', () => {
    const empty = new DeviceDetailAdapterRegistry().buildContext({ informationSections: [], sites: [], certificates: [], logs: [], extension: { type: 'GENERIC' } })
    expect(deviceDetailTabRegistry.resolve(empty).map(tab => tab.key)).toEqual(['overview', 'logs'])

    const adc = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      sites: [
        { id: 'lb_1', siteAssetId: 'lb_1', kind: 'LB', name: 'lb', bindings: [], metadata: {} },
        { id: 'vpn_1', siteAssetId: 'vpn_1', kind: 'VPN', name: 'vpn', bindings: [], metadata: {} },
      ],
      certificates: [{ id: 'cert_1', name: 'cert' }],
      logs: [],
      extension: { type: 'CITRIX_ADC' },
    })
    expect(deviceDetailTabRegistry.resolve(adc).map(tab => tab.key)).toEqual(['overview', 'certificates', 'lb', 'vpn', 'logs'])
  })

  it('统一详情沿用旧 Agent 视觉骨架且保留双列站点布局', () => {
    const modalSource = readFileSync(resolve(process.cwd(), 'src/views/devices/details/ManagedDeviceDetailModal.vue'), 'utf8')
    const sitesSource = readFileSync(resolve(process.cwd(), 'src/views/devices/details/tabs/DeviceSitesTab.vue'), 'utf8')

    expect(modalSource).toContain('agent-detail-modal__hero')
    expect(modalSource).toContain('agent-detail-modal__spotlight')
    expect(modalSource).toContain('agent-detail-modal__tab')
    expect(modalSource).toContain('width="82vw"')
    expect(modalSource).toContain('@certificate-click="openCertificateDetail"')
    expect(modalSource).toContain('CertificateDetailPanel')
    expect(modalSource).toContain('certificateAssetDetailOpen.value = true')
    expect(modalSource).toContain("context.value?.permissions.has('REFRESH_DISCOVERY')")
    expect(modalSource).toContain('refreshManagedDeviceDiscovery(deviceAssetId.value)')
    expect(modalSource).toContain('@click="refreshDiscovery"')
    expect(modalSource).toContain('getManagedDevice(openedDeviceId.value)')
    expect(modalSource).not.toContain('@click="openCertificateAssetDetail"')
    expect(modalSource).not.toContain('selectedCertificate.value !== selection')
    expect(modalSource).not.toContain('device-detail__hero')
    expect(sitesSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  })
})
