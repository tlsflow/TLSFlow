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
      frameworks: [
        { stableKey: 'framework:nitro', displayName: 'NITRO', type: 'ADC' },
        { stableKey: 'framework:kubernetes', displayName: 'Ingress Controller', frameworkType: 'kubernetes.controller', presentation: { typeLabel: 'Kubernetes 控制器' } },
      ],
      allowedActions: ['VIEW_RUNTIME'],
    })
    expect(context.overviewSections[0]?.key).toBe('common')
    expect(context.permissions.has('VIEW_RUNTIME')).toBe(true)
    expect(context.certificates[0]?.certificateAssetId).toBe('asset_1')
    expect(context.certificates[0]?.certificateVersionId).toBe('version_1')
    expect(context.frameworks[0]).toMatchObject({ id: 'framework:nitro', name: 'NITRO', type: 'ADC' })
    expect(context.frameworks[1]).toMatchObject({ id: 'framework:kubernetes', name: 'Ingress Controller', type: 'Kubernetes 控制器' })
  })

  it('站点绑定证书可使用指纹作为稳定身份', () => {
    const context = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      sites: [{
        id: 'site_web',
        siteAssetId: 'site_web',
        kind: 'web.site',
        frameworkType: 'web.iis',
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
      sites: [{ id: 'site_1', siteAssetId: 'site_1', kind: 'web.site', frameworkType: 'web.generic', name: 'Default', bindings: [], metadata: {} }],
      certificates: [],
      logs: [],
    })
    const registry = new DeviceDetailTabRegistry([{
      key: 'sites',
      supports: () => true,
      getTabs: () => [{ key: 'sites', labelKey: 'devices.detail.tabs.sites', order: 300, component, isVisible: current => current.sites.length > 0 }],
    }, {
      key: 'duplicate',
      supports: () => true,
      getTabs: () => [{ key: 'sites', labelKey: 'devices.detail.tabs.sites', order: 400, component, isVisible: () => true }],
    }])
    expect(registry.resolve(context).map(tab => tab.key)).toEqual(['sites'])
  })

  it('默认标签始终显示，框架实例直接成为站点详情标签', () => {
    const empty = new DeviceDetailAdapterRegistry().buildContext({ informationSections: [], sites: [], certificates: [], logs: [], extension: { type: 'GENERIC' } })
    expect(deviceDetailTabRegistry.resolve(empty).map(tab => tab.key)).toEqual(['overview', 'logs'])

    const adc = new DeviceDetailAdapterRegistry().buildContext({
      category: 'NETWORK_APPLIANCE',
      informationSections: [],
      frameworks: [{ stableKey: 'framework:nitro', displayName: 'NITRO', type: 'ADC' }],
      sites: [
        { id: 'lb_1', siteAssetId: 'lb_1', kind: 'network.virtual-server', frameworkType: 'network.load-balancer', name: 'lb', bindings: [], metadata: { virtualServerType: 'LB' } },
        { id: 'vpn_1', siteAssetId: 'vpn_1', kind: 'network.virtual-server', frameworkType: 'network.load-balancer', name: 'vpn', bindings: [], metadata: { virtualServerType: 'VPN' } },
      ],
      certificates: [{ id: 'cert_1', name: 'cert' }],
      logs: [],
      extension: { type: 'CITRIX_ADC' },
    })
    const tabs = deviceDetailTabRegistry.resolve(adc)
    expect(tabs.map(tab => tab.key)).toEqual(['overview', 'framework:framework:nitro', 'certificates', 'logs'])
    expect(tabs.find(tab => tab.key === 'framework:framework:nitro')).toMatchObject({ label: 'NITRO' })
  })

  it('框架或站点存在时保留证书标签，供按需汇总绑定证书', () => {
    const frameworkOnly = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      frameworks: [{ id: 'framework_iis', displayName: 'IIS', frameworkType: 'web.iis' }],
      sites: [],
      certificates: [],
      logs: [],
      resourceCounts: { frameworks: 1, sites: 0, certificates: 0, logs: 0 },
    })
    const siteOnly = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      frameworks: [],
      sites: [],
      certificates: [],
      logs: [],
      resourceCounts: { frameworks: 0, sites: 1, certificates: 0, logs: 0 },
    })

    expect(deviceDetailTabRegistry.resolve(frameworkOnly).map(tab => tab.key)).toContain('certificates')
    expect(deviceDetailTabRegistry.resolve(siteOnly).map(tab => tab.key)).toContain('certificates')
  })

  it('标准站点分类和未知插件分类均由通用标签完整保留', () => {
    const context = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      sites: [
        {
          id: 'web_1',
          siteAssetId: 'web_1',
          kind: 'web.site',
          frameworkType: 'web.nginx',
          name: 'Web',
          presentation: { groupKey: 'web.nginx', groupLabelKey: 'fixture.web.group', typeLabelKey: 'fixture.web.type', groupLabel: 'NGINX', typeLabel: 'NGINX' },
          bindings: [],
          metadata: {},
        },
        {
          id: 'k8s_1',
          siteAssetId: 'k8s_1',
          kind: 'kubernetes.ingress',
          frameworkType: 'kubernetes.cluster',
          name: 'Ingress',
          presentation: { groupKey: 'kubernetes.cluster', groupLabelKey: 'fixture.k8s.group', typeLabelKey: 'fixture.k8s.type', groupLabel: 'Kubernetes', typeLabel: 'Ingress' },
          bindings: [],
          metadata: {},
        },
      ],
      certificates: [],
      logs: [],
    })

    expect(context.sites.map(site => site.kind)).toEqual(['web.site', 'kubernetes.ingress'])
    const tabs = deviceDetailTabRegistry.resolve(context)
    expect(tabs.map(tab => tab.key)).toEqual(['overview', 'sites:web.nginx', 'sites:kubernetes.cluster', 'certificates', 'logs'])
    expect(tabs.find(tab => tab.key === 'sites:web.nginx')?.label).toBe('NGINX')
    expect(tabs.find(tab => tab.key === 'sites:web.nginx')?.buildProps?.(context)).toEqual({ sites: [context.sites[0]] })
  })

  it('内置框架缺少 presentation 标签时回退到统一 i18n key', () => {
    const context = new DeviceDetailAdapterRegistry().buildContext({
      informationSections: [],
      sites: [
        { id: 'apache_1', siteAssetId: 'apache_1', kind: 'web.site', frameworkType: 'web.apache', name: 'Apache', bindings: [], metadata: {} },
        { id: 'tomcat_1', siteAssetId: 'tomcat_1', kind: 'web.site', frameworkType: 'app.tomcat', name: 'Tomcat', bindings: [], metadata: {} },
      ],
      certificates: [],
      logs: [],
    })

    const tabs = deviceDetailTabRegistry.resolve(context)
    expect(tabs.find(tab => tab.key === 'sites:web.apache')).toMatchObject({ label: undefined, labelKey: 'devices.unifiedDetail.tabs.apache' })
    expect(tabs.find(tab => tab.key === 'sites:app.tomcat')).toMatchObject({ label: undefined, labelKey: 'devices.unifiedDetail.tabs.tomcat' })
  })

  it('设备列表区分设备版本和控制版本', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/devices/DevicesView.vue'), 'utf8')
    expect(source).toContain("key: 'deviceVersion'")
    expect(source).toContain("candidates: ['softwareVersion']")
    expect(source).toContain("key: 'controlVersion'")
    expect(source).toContain("candidates: ['controlVersion']")
  })

  it('设备详情弹窗使用紧凑的十五像素上下间距', () => {
    const modalSource = readFileSync(resolve(process.cwd(), 'src/views/devices/details/ManagedDeviceDetailModal.vue'), 'utf8')

    expect(modalSource).toContain('dialog-class="device-detail-dialog"')
    expect(modalSource).toContain(':global(.device-detail-dialog .gc-modal__header)')
    expect(modalSource).toContain(':global(.device-detail-dialog .gc-modal__body)')
    expect(modalSource).toContain('padding-block: var(--gc-space-modal-detail-y)')
  })

  it('应用资产向导进入部署模式时刷新当前 ACTIVE 发现数据', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/assets/AssetsView.vue'), 'utf8')
    expect(source).toContain("filters: { deviceId: hostId, status: 'ACTIVE' }")
    expect(source).toContain('await refreshManagedTargetSelection()')
    expect(source).toContain('await refreshAssetTargets()')
    expect(source).toContain('await loadManagedTargets(assetDraft.siteAssetId)')
  })

  it('统一详情沿用旧 Agent 视觉骨架且保留双列站点布局', () => {
    const modalSource = readFileSync(resolve(process.cwd(), 'src/views/devices/details/ManagedDeviceDetailModal.vue'), 'utf8')
    const sitesSource = readFileSync(resolve(process.cwd(), 'src/views/devices/details/tabs/DeviceSitesTab.vue'), 'utf8')

    expect(modalSource).toContain('agent-detail-modal__hero')
    expect(modalSource).toContain('agent-detail-modal__spotlight')
    expect(modalSource).toContain('agent-detail-modal__tab')
    expect(modalSource).toContain('agent-detail-modal__actions')
    expect(modalSource).toContain('size="xxl"')
    expect(modalSource).not.toContain('width="82vw"')
    expect(modalSource).toContain('<template #header-actions>')
    expect(modalSource).not.toContain(':description="t(\'devices.unifiedDetail.modalDescription\')"')
    expect(modalSource).toContain('@certificate-click="openCertificateDetail"')
    expect(modalSource).toContain('CertificateDetailPanel')
    expect(modalSource).toContain('certificateAssetDetailOpen.value = true')
    expect(modalSource).toContain('@click="executePluginAction(action.capabilityKey)"')
    expect(modalSource).toContain("allowedActions.includes('device.discover')")
    expect(modalSource).toContain("pluginCapabilities.includes('device.discover')")
    expect(modalSource).toContain("executePluginAction('device.discover')")
    expect(modalSource).toContain("action.capabilityKey !== 'device.discover'")
    expect(modalSource).toContain('getManagedDevice(openedDeviceId.value, locale.value)')
    expect(modalSource).toContain("activeTab.value === 'certificates'")
    expect(modalSource).toContain('loading: loadingTab && activeTabLoadsDeferredResources')
    expect(modalSource).not.toContain('@click="openCertificateAssetDetail"')
    expect(modalSource).not.toContain('selectedCertificate.value !== selection')
    expect(modalSource).not.toContain('device-detail__hero')
    expect(modalSource).not.toContain('GcDevicePresentation')
    expect(sitesSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(sitesSource).toContain('v-if="loading"')
    expect(sitesSource).toContain('agent-detail-modal__site-spinner')

    const certificatesSource = readFileSync(resolve(process.cwd(), 'src/views/devices/details/tabs/DeviceCertificatesTab.vue'), 'utf8')
    expect(certificatesSource).toContain('loading?: boolean')
    expect(certificatesSource).toContain('v-if="loading"')
    expect(certificatesSource).toContain('v-else-if="certificates.length"')
    expect(certificatesSource).toContain('agent-detail-modal__certificate-spinner')
  })
})
