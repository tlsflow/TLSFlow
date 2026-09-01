import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { usePermissionStore } from '@/stores/permission.store'
import { i18n } from '@/i18n'

const assetMocks = vi.hoisted(() => ({
  createHost: vi.fn(),
  updateHost: vi.fn(),
  deleteHost: vi.fn(),
  deleteFrameworkInstance: vi.fn(),
  listApplications: vi.fn(),
  listCapabilities: vi.fn(),
  matchCapabilityRequirement: vi.fn(),
  evaluateCapabilityCompatibility: vi.fn(),
  listFrameworkInstances: vi.fn(),
  createFrameworkInstance: vi.fn(),
  updateFrameworkInstance: vi.fn(),
  previewDiscoveryMerge: vi.fn(),
  startDiscovery: vi.fn(),
  createServiceAsset: vi.fn(),
  updateServiceAsset: vi.fn(),
  deleteServiceAsset: vi.fn(),
  getApplicationDetail: vi.fn(),
  listAgents: vi.fn(),
  listSiteAssets: vi.fn(),
  createSiteAsset: vi.fn(),
  listManagedTargets: vi.fn(),
  getManagedTargetEffectiveCapability: vi.fn(),
  listManagedTargetCompatiblePlugins: vi.fn(),
  saveApplicationAssetManagedTarget: vi.fn(),
  saveApplicationAssetStandaloneWorkflow: vi.fn(),
  createManagedTarget: vi.fn(),
  listManagedTargetSnapshots: vi.fn(),
}))

const certificateMocks = vi.hoisted(() => ({
  listCertificateFormats: vi.fn(),
  listCertificateVersions: vi.fn(),
  listCertificates: vi.fn(),
  createCertificateFormat: vi.fn(),
  exportCertificateFormatArtifact: vi.fn(),
  downloadCertificateFormatArtifact: vi.fn(),
  updateCertificateFormat: vi.fn(),
  deleteCertificateFormat: vi.fn(),
}))

const workflowMocks = vi.hoisted(() => ({
  getWorkflowExecutionBinding: vi.fn(),
  listWorkflowTemplates: vi.fn(),
  listWorkflowTemplateVersions: vi.fn(),
}))

const gatewayMocks = vi.hoisted(() => ({
  listGateways: vi.fn(),
}))

const securityMocks = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
}))

const credentialMocks = vi.hoisted(() => ({
  listCredentials: vi.fn(),
  getCredential: vi.fn(),
}))

const deviceMocks = vi.hoisted(() => ({
  listManagedDevices: vi.fn(),
}))

const deploymentInputMocks = vi.hoisted(() => ({
  projectDeploymentInputs: vi.fn(),
  projectApplicationAssetPluginInputs: vi.fn(),
}))

const pluginMocks = vi.hoisted(() => ({
  listAgentPluginPackages: vi.fn(),
  listPluginCatalog: vi.fn(),
  previewAgentPluginBinding: vi.fn(),
}))

vi.mock('@/api/modules/assets.api', () => assetMocks)
vi.mock('@/api/modules/certificates.api', () => certificateMocks)
vi.mock('@/api/modules/workflow-templates.api', () => workflowMocks)
vi.mock('@/api/modules/gateways.api', () => gatewayMocks)
vi.mock('@/api/modules/security.api', () => securityMocks)
vi.mock('@/api/modules/credentials.api', () => credentialMocks)
vi.mock('@/api/modules/devices.api', () => deviceMocks)
vi.mock('@/api/modules/deployment-inputs.api', () => deploymentInputMocks)
vi.mock('@/api/modules/plugins.api', () => pluginMocks)

import AssetsView from '@/views/applications/ApplicationsView.vue'
import BindingsView from '@/views/bindings/BindingsView.vue'

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_ok',
    timestamp: '2026-06-09T00:00:00.000Z',
  }
}

function okRecord(data: Record<string, unknown> = { id: 'ok' }, requestId = 'req_action') {
  return { data, requestId, timestamp: '2026-06-09T00:00:00.000Z' }
}

function createBusinessRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/applications', component: { template: '<div />' } },
      { path: '/bindings', component: { template: '<div />' } },
      { path: '/certificates', component: { template: '<div />' } },
    ],
  })
}

function mountBusinessView(component: typeof AssetsView | typeof BindingsView) {
  return mount(component, {
    global: {
      plugins: [createBusinessRouter(), i18n],
      stubs: {
        teleport: true,
        Teleport: true,
        ApplicationOnboardingModal: defineComponent({
          name: 'ApplicationOnboardingModalStub',
          props: { open: { type: Boolean, default: false } },
          emits: ['update:open', 'customManual', 'addDevice'],
          template: '<div v-if="open" data-testid="application-onboarding-modal"><button type="button" @click="$emit(\'customManual\')">传统手动创建</button></div>',
        }),
      },
    },
  })
}

async function openProfessionalAssetForm(wrapper: ReturnType<typeof mountBusinessView>) {
  const addButton = wrapper.findAll('button').find((button) => button.text() === '添加应用')
  expect(addButton).toBeTruthy()
  await addButton!.trigger('click')
  await flushPromises()

  const manualButton = wrapper.findAll('button').find((button) => button.text() === '传统手动创建')
  expect(manualButton).toBeTruthy()
  await manualButton!.trigger('click')
  await flushPromises()
}

async function setInputElementValue(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

describe('应用与证书产物视图', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    usePermissionStore().setPermissions([
      'service_asset.read',
      'service_asset.manage',
      'binding.read',
      'certificate.format.create',
    ])

    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-1',
        address: 'www.example.com',
        displayName: 'www.example.com',
        addressType: 'DOMAIN',
        port: 443,
        protocol: 'HTTPS',
        platform: 'LINUX',
        status: 'ACTIVE',
      },
    ]))
    assetMocks.listFrameworkInstances.mockResolvedValue(okPage([
      { id: 'svc-1', displayName: 'nginx-main', providerType: 'NGINX', hostId: 'host-1', rawFacts: { ports: [443] } },
    ]))
    assetMocks.listAgents.mockResolvedValue(okPage([{ id: 'agent-1', displayName: 'agent-1' }]))
    assetMocks.listSiteAssets.mockResolvedValue(okPage([]))
    assetMocks.listManagedTargets.mockResolvedValue(okPage([]))
    assetMocks.getManagedTargetEffectiveCapability.mockResolvedValue(okRecord({
      capabilityKey: 'certificate.deploy',
      source: { ownerType: 'MANAGED_TARGET', ownerId: 'target-1', precedence: 'TARGET_OVERRIDE' },
      plugin: { pluginVersionId: 'plugin-version-default', pluginId: 'builtin.windows.iis.pfx', runtime: 'AGENT_ATOMIC' },
      binding: { pluginBindingId: 'binding-default', status: 'ACTIVE', version: 1 },
      executionLocation: 'AGENT',
    }))
    assetMocks.listManagedTargetCompatiblePlugins.mockResolvedValue(okRecord({ items: [] }))
    assetMocks.saveApplicationAssetManagedTarget.mockResolvedValue(okRecord({ target: { id: 'target-binding-1' } }))
    assetMocks.listManagedTargetSnapshots.mockResolvedValue(okPage([]))
    assetMocks.getApplicationDetail.mockResolvedValue(okRecord({ id: 'asset-1' }))
    deploymentInputMocks.projectDeploymentInputs.mockResolvedValue(okRecord({
      contractVersion: 'gcac.deployment-input-contract/v1',
      requiredVariables: [], advancedVariables: [], connections: [], credentials: [], artifacts: [], fixedValues: [], runtimeValues: [], issues: [], saveable: true,
    }))
    deploymentInputMocks.projectApplicationAssetPluginInputs.mockResolvedValue(okRecord({
      contractVersion: 'gcac.deployment-input-contract/v1',
      requiredVariables: [], advancedVariables: [], connections: [], credentials: [], artifacts: [], fixedValues: [], runtimeValues: [], issues: [], saveable: true,
    }))
    assetMocks.listCapabilities.mockResolvedValue(okPage([]))
    assetMocks.matchCapabilityRequirement.mockResolvedValue(okRecord({ satisfiedCapabilities: [], missingCapabilities: [] }))
    assetMocks.evaluateCapabilityCompatibility.mockResolvedValue(okRecord({ compatibilityLevel: 'L2', manualDeclarations: [] }))
    assetMocks.createServiceAsset.mockResolvedValue(okRecord({ id: 'asset-2' }, 'req_asset_create'))
    assetMocks.updateServiceAsset.mockResolvedValue(okRecord({ id: 'asset-1' }, 'req_asset_update'))
    assetMocks.deleteServiceAsset.mockResolvedValue(okRecord({ id: 'asset-1' }, 'req_asset_delete'))
    assetMocks.createSiteAsset.mockResolvedValue(okRecord({ id: 'site-1' }, 'req_site_create'))
    assetMocks.createManagedTarget.mockResolvedValue(okRecord({ id: 'target-1' }, 'req_target_create'))
    workflowMocks.listWorkflowTemplates.mockResolvedValue(okPage([
      { id: 'workflow-1', name: 'Apache 证书替换', origin: 'legacy' },
    ]))
    workflowMocks.listWorkflowTemplateVersions.mockResolvedValue({
      data: {
        items: [{
          id: 'workflow-version-1',
          version: 'v1',
          status: 'published',
          templateId: 'workflow-1',
          content: {
            inputContract: {
              apiVersion: 'gcac.deployment-input/v1',
              variables: {
                deviceHost: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'asset', path: 'asset.address' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed', description: '目标主机' },
                verifyUrl: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'asset', path: 'target.verifyUrl' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed', description: '验证 URL' },
              },
              connections: {},
              credentials: {},
              artifacts: {
                serverCert: {
                  kind: 'certificate',
                  required: true,
                  configurationMode: 'required',
                  lifecycle: 'pre_execution',
                  artifactContract: {
                    outputs: {
                      certFile: { role: 'public_certificate', required: true, description: '服务端证书文件' },
                      keyFile: { role: 'private_key', required: true, description: '服务端私钥文件' },
                    },
                  },
                },
              },
            },
          },
        }],
      },
      requestId: 'req_workflow_versions',
      timestamp: '2026-06-09T00:00:00.000Z',
    })
    gatewayMocks.listGateways.mockResolvedValue(okPage([
      { id: 'gateway-1', name: 'gw-east', status: 'online' },
    ]))
    securityMocks.listSecrets.mockResolvedValue(okPage([]))
    securityMocks.createSecret.mockResolvedValue(okRecord({ id: 'secret-export-1', secretRef: 'secret://pfx_password/export-1#current' }))
    credentialMocks.listCredentials.mockResolvedValue(okPage([]))
    credentialMocks.getCredential.mockResolvedValue(okRecord())
    deviceMocks.listManagedDevices.mockResolvedValue(okPage([
      {
        id: 'host-1',
        displayName: 'Windows Agent',
        productFamily: 'WINDOWS_AGENT',
        extensionType: 'AGENT',
      },
      {
        id: 'host-adc-1',
        displayName: 'ADC 01',
        productFamily: 'CITRIX_ADC',
        extensionType: 'NETWORK_APPLIANCE',
      },
    ]))
    pluginMocks.listAgentPluginPackages.mockResolvedValue(okPage([]))
    pluginMocks.listPluginCatalog.mockResolvedValue(okPage([]))
    pluginMocks.previewAgentPluginBinding.mockResolvedValue(okRecord({}))

    certificateMocks.listCertificateFormats.mockResolvedValue(okPage([
      {
        id: 'certfmt-1',
        format: 'pem',
        containsPrivateKey: true,
        createdAt: '2026-06-23T10:00:00.000Z',
        parameters: {
          configName: 'Windows-设备兼容单文件PEM模板',
          alias: '',
          systemPlatform: 'windows',
          runtimePlatform: 'other',
          outputPreset: 'pem_bundle',
          engineFormat: 'pem',
          extension: 'crt',
          publicEncoding: 'pem',
          privateEncoding: 'pem',
          includeLeafCertificate: true,
          includeCertificateChain: true,
          includePrivateKey: true,
          generateChainFile: false,
          generatePrivateKeyFile: false,
        },
      },
    ]))
    certificateMocks.listCertificateVersions.mockResolvedValue(okPage([
      { id: 'certver-1', certificateAssetId: 'certasset-1', versionNo: 3, commonName: 'www.example.com', notAfter: '2027-06-23T10:00:00.000Z', status: 'active' },
    ]))
    certificateMocks.listCertificates.mockResolvedValue(okPage([
      { id: 'certasset-1', name: 'www.example.com', primaryDomain: 'www.example.com' },
    ]))
    certificateMocks.createCertificateFormat.mockResolvedValue(okRecord({ id: 'certfmt-2' }, 'req_format_create'))
    certificateMocks.exportCertificateFormatArtifact.mockResolvedValue(okRecord({ artifactRef: 'artifact://certificate-format/certfmt-1/test' }, 'req_format_export'))
    certificateMocks.downloadCertificateFormatArtifact.mockResolvedValue(new Response(Buffer.from('certificate'), { status: 200, headers: { 'content-type': 'application/x-pem-file' } }))
    certificateMocks.updateCertificateFormat.mockResolvedValue(okRecord({ id: 'certfmt-1' }, 'req_format_update'))
    certificateMocks.deleteCertificateFormat.mockResolvedValue(okRecord({ id: 'certfmt-1' }, 'req_format_delete'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('应用页使用统一工作台和三步执行进度', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="asset-professional-workspace"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="asset-professional-card-grid"]').exists()).toBe(true)
    expect(wrapper.find('.business-page').exists()).toBe(false)

    await openProfessionalAssetForm(wrapper)

    const progress = wrapper.find('.asset-wizard__progress [role="progressbar"]')
    expect(progress.exists()).toBe(true)
    expect(progress.attributes('aria-valuenow')).toBe('1')
    expect(progress.attributes('aria-valuemax')).toBe('3')
  })

  it('专业应用页按 CertFlow 卡片布局支持多选，详情仍从卡片操作可达', async () => {
    usePermissionStore().setPermissions([
      'service_asset.read',
      'service_asset.manage',
      'binding.read',
      'certificate.format.create',
      'deployment.plan.execute',
    ])
    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-card-1',
        address: 'card.example.com',
        displayName: 'card.example.com',
        port: 443,
        protocol: 'HTTPS',
        verifyUrl: 'https://card.example.com/health',
        platform: 'LINUX',
        status: 'ACTIVE',
        targetBinding: {
          siteName: 'production-web',
          pluginVersionId: 'plugin-version-nginx',
        },
        currentCertificate: {
          commonName: '*.example.com',
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2099-06-15T23:59:59.000Z',
        },
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const card = wrapper.get('[data-testid="asset-professional-card"]')
    expect(card.text()).toContain('card.example.com')
    expect(card.text()).toContain('*.example.com')
    expect(card.text()).not.toContain('production-web')
    expect(card.find('.asset-page__card-heading p').text()).toBe('https://card.example.com')
    expect(card.find('.asset-page__card-icon img').attributes('src')).toBe('/api/v1/plugin-versions/plugin-version-nginx/resources/logos/square')
    expect(card.find('.asset-page__card-meta').exists()).toBe(false)
    expect(card.find('[role="progressbar"]').exists()).toBe(false)
    expect(card.find('[data-testid="asset-card-select-asset-card-1"]').exists()).toBe(true)
    expect(card.find('.asset-page__card-certificate-remaining').text()).toMatch(/^\d+ 天$/)
    expect(card.find('.asset-page__card-certificate-state').text()).toBe('正常')
    expect(wrapper.find('.asset-page__workspace-selected-count').exists()).toBe(false)
    const latestAction = card.find('[data-testid="asset-card-deploy-asset-card-1"]')
    expect(latestAction.text()).toContain('证书最新')
    expect(latestAction.classes()).toContain('asset-page__card-deploy-button--latest')
    expect(card.find('[data-testid="asset-card-detail-asset-card-1"] svg').exists()).toBe(true)
    expect(card.find('[data-testid="asset-card-edit-asset-card-1"] svg').exists()).toBe(true)
    expect(card.find('[data-testid="asset-card-delete-asset-card-1"] svg').exists()).toBe(true)
    expect(card.find('[data-testid="asset-card-detail-asset-card-1"]').classes()).toContain('asset-page__card-icon-action')
    expect(card.find('[data-testid="asset-card-edit-asset-card-1"]').classes()).toContain('asset-page__card-icon-action')
    expect(card.find('[data-testid="asset-card-delete-asset-card-1"] button').classes()).toContain('asset-page__card-icon-action')

    await card.get('[data-testid="asset-card-select-asset-card-1"]').setValue(true)
    expect(card.classes()).toContain('gc-pro-card--selected')
    expect(wrapper.text()).toContain('已选中 1 / 1 个资产')

    await wrapper.get('[data-testid="asset-card-detail-asset-card-1"]').trigger('click')
    await flushPromises()
    expect(assetMocks.getApplicationDetail).toHaveBeenCalledWith('asset-card-1')

    expect(wrapper.find('[data-testid="asset-professional-view-tabs"]').exists()).toBe(false)
    expect(wrapper.find('.business-page').exists()).toBe(false)
  })

  it('专业应用页支持切换表格视图并按表头稳定排序', async () => {
    assetMocks.listApplications.mockResolvedValue(okPage([
      { id: 'asset-sort-b', address: 'b.example.com', displayName: 'b.example.com', port: 8443, protocol: 'HTTPS', platform: 'WINDOWS', targetBinding: { deviceDisplayName: 'device-b' }, status: 'ACTIVE', currentCertificate: { updateAvailable: true } },
      { id: 'asset-sort-a', address: 'a.example.com', displayName: 'a.example.com', port: 443, protocol: 'HTTPS', platform: 'LINUX', targetBinding: { deviceDisplayName: 'device-a' }, status: 'ACTIVE', currentCertificate: { notAfter: '2099-06-15T23:59:59.000Z' } },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="asset-professional-card"]')
    expect(cards[0]?.text()).toContain('a.example.com')

    const presentationButtons = wrapper.findAll('.asset-page__presentation-toggle-button')
    expect(presentationButtons).toHaveLength(2)
    await presentationButtons[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="asset-professional-card-grid"]').exists()).toBe(false)
    const table = wrapper.get('.asset-page__asset-table')
    expect(table.text()).toContain('a.example.com')
    expect(table.text()).toContain('b.example.com')
    expect(table.text()).toContain('所属设备')
    expect(table.text()).toContain('device-a')
    expect(table.text()).not.toContain('平台')
    expect(table.find('[data-testid="asset-list-select-asset-sort-a"]').exists()).toBe(true)
    const categoryTabs = wrapper.findAll('.certificate-page__category-tab')
    expect(categoryTabs.map((tab) => tab.text())).toEqual(['全部', '正常', '可更新'])
    await categoryTabs[2]!.trigger('click')
    await flushPromises()
    expect(table.findAll('tbody tr')).toHaveLength(1)
    expect(table.find('.asset-page__card-certificate-state').text()).toBe('可更新')
    expect(table.find('.asset-page__card-certificate-state').classes()).toContain('gc-tag--warning')
    await categoryTabs[0]!.trigger('click')
    await flushPromises()

    const domainHeader = table.find('.asset-page__header-sort')
    await domainHeader.trigger('click')
    expect(domainHeader.text()).toContain('↓')
    await domainHeader.trigger('click')
    expect(domainHeader.text()).toContain('↑')
    const rows = table.findAll('tbody tr')
    expect(rows[0]?.text()).toContain('a.example.com')
  })

  it('多选资产绑定同一证书域名时显示批量更新证书入口', async () => {
    usePermissionStore().setPermissions([
      'service_asset.read',
      'service_asset.manage',
      'deployment.plan.execute',
    ])
    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-bulk-same-1',
        address: 'first.example.com',
        status: 'ACTIVE',
        currentCertificate: { commonName: 'EXAMPLE.COM.' },
      },
      {
        id: 'asset-bulk-same-2',
        address: 'second.example.com',
        status: 'ACTIVE',
        currentCertificate: { commonName: 'example.com' },
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    await wrapper.get('[data-testid="asset-card-select-asset-bulk-same-1"]').setValue(true)
    await wrapper.get('[data-testid="asset-card-select-asset-bulk-same-2"]').setValue(true)

    expect(wrapper.find('[data-testid="asset-selection-actions"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="asset-bulk-delete-action"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="asset-bulk-update-action"]').text()).toContain('批量更新证书')
  })

  it('多选资产绑定不同证书域名时隐藏批量更新证书入口', async () => {
    usePermissionStore().setPermissions([
      'service_asset.read',
      'service_asset.manage',
      'deployment.plan.execute',
    ])
    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-bulk-different-1',
        address: 'first.example.com',
        status: 'ACTIVE',
        currentCertificate: { commonName: 'first.example.com' },
      },
      {
        id: 'asset-bulk-different-2',
        address: 'second.example.com',
        status: 'ACTIVE',
        currentCertificate: { commonName: 'second.example.com' },
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    await wrapper.get('[data-testid="asset-card-select-asset-bulk-different-1"]').setValue(true)
    await wrapper.get('[data-testid="asset-card-select-asset-bulk-different-2"]').setValue(true)

    expect(wrapper.find('[data-testid="asset-selection-actions"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="asset-bulk-delete-action"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="asset-bulk-update-action"]').exists()).toBe(false)
  })

  it('绑定证书不是证书资产最新版本时显示可更新状态', async () => {
    usePermissionStore().setPermissions([
      'service_asset.read',
      'service_asset.manage',
      'deployment.plan.execute',
    ])
    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-update-available',
        address: 'update.example.com',
        displayName: 'update.example.com',
        port: 443,
        protocol: 'HTTPS',
        status: 'ACTIVE',
        currentCertificate: {
          commonName: '*.example.com',
          notAfter: '2099-06-15T23:59:59.000Z',
          updateAvailable: true,
        },
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const card = wrapper.get('[data-testid="asset-professional-card"]')
    expect(card.find('.asset-page__card-certificate-state').text()).toBe('可更新')
    expect(card.find('.gc-tag--warning').exists()).toBe(true)
    const action = card.get('[data-testid="asset-card-deploy-asset-update-available"]')
    expect(action.text()).toContain('证书更新')
    expect(action.classes()).toContain('asset-page__card-deploy-button--update')
  })

  it('已过期证书显示蓝色的证书更新入口', async () => {
    usePermissionStore().setPermissions([
      'service_asset.read',
      'service_asset.manage',
      'deployment.plan.execute',
    ])
    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-expired',
        address: 'expired.example.com',
        displayName: 'expired.example.com',
        port: 443,
        protocol: 'HTTPS',
        status: 'ACTIVE',
        currentCertificate: {
          commonName: '*.example.com',
          notAfter: '2026-01-01T00:00:00.000Z',
          updateAvailable: false,
        },
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const card = wrapper.get('[data-testid="asset-professional-card"]')
    expect(card.find('.asset-page__card-certificate-state').text()).toBe('已过期')
    const action = card.get('[data-testid="asset-card-deploy-asset-expired"]')
    expect(action.text()).toContain('证书更新')
    expect(action.classes()).toContain('asset-page__card-deploy-button--update')
  })

  it('绑定证书是证书资产当前版本时显示正常状态', async () => {
    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-current-version',
        address: 'current.example.com',
        displayName: 'current.example.com',
        port: 443,
        protocol: 'HTTPS',
        status: 'ACTIVE',
        currentCertificate: {
          commonName: '*.example.com',
          notAfter: '2099-06-15T23:59:59.000Z',
          updateAvailable: false,
        },
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const card = wrapper.get('[data-testid="asset-professional-card"]')
    expect(card.find('.asset-page__card-certificate-state').text()).toBe('正常')
    expect(card.find('.gc-tag--success').exists()).toBe(true)
    expect(card.find('.gc-tag--warning').exists()).toBe(false)
  })

  it('卡片工作台按服务端分页和筛选条件加载资产', async () => {
    assetMocks.listApplications.mockImplementation(async (query?: { readonly page?: number }) => {
      const page = query?.page ?? 1
      return {
        data: {
          items: page === 1
            ? [{ id: 'asset-page-1', address: 'first.example.com', status: 'ACTIVE' }]
            : [{ id: 'asset-page-2', address: 'second.example.com', status: 'INACTIVE' }],
          page,
          pageSize: 20,
          total: 21,
        },
        requestId: `req_asset_page_${page}`,
        timestamp: '2026-06-09T00:00:00.000Z',
      }
    })

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    expect(assetMocks.listApplications).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      sort: 'address:asc',
      filters: { address: '', status: '' },
    })
    expect(wrapper.find('[data-testid="asset-overview-pagination"]').exists()).toBe(true)

    await wrapper.get('[data-testid="asset-overview-pagination"]').get('button[aria-label="下一页"]').trigger('click')
    await flushPromises()

    expect(assetMocks.listApplications).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
      sort: 'address:asc',
      filters: { address: '', status: '' },
    })
    expect(wrapper.text()).toContain('second.example.com')

    await wrapper.get('[data-testid="asset-overview-filter-toggle"]').trigger('click')
    await wrapper.get('[data-testid="asset-overview-status-filter"]').setValue('ACTIVE')
    await flushPromises()

    expect(assetMocks.listApplications).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      sort: 'address:asc',
      filters: { address: '', status: 'ACTIVE' },
    })
  })

  it('卡片操作遵守应用资产读写权限', async () => {
    usePermissionStore().setPermissions(['service_asset.read'])

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="asset-card-detail-asset-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="asset-card-edit-asset-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="asset-card-delete-asset-1"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text() === '添加应用')).toBe(false)
  })

  it('应用资产平台使用固定标识选项且不依赖设备记录', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    await openProfessionalAssetForm(wrapper)

    const platformField = wrapper.findAll('label').find((label) => label.text().includes('平台 *'))
    expect(platformField).toBeTruthy()
    expect(platformField!.findAll('option').map((option) => option.attributes('value'))).toEqual(['LINUX', 'WINDOWS', 'APPLIANCE'])
  })

  it('编辑应用资产时允许修改平台标识', async () => {
    assetMocks.getApplicationDetail.mockResolvedValue(okRecord({
      id: 'asset-1',
      address: 'www.example.com',
      port: 443,
      protocol: 'HTTPS',
      platform: 'WINDOWS',
    }))
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const editButton = wrapper.findAll('button').find((button) => button.text() === '编辑')
    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')
    await flushPromises()

    const platformField = wrapper.findAll('label').find((label) => label.text().includes('平台 *'))
    const platformSelect = platformField!.find('select')
    expect(platformSelect.exists()).toBe(true)
    expect(platformSelect.element.value).toBe('WINDOWS')

    await platformSelect.setValue('APPLIANCE')
    expect(platformSelect.element.value).toBe('APPLIANCE')
  })

  it('资产页仍然可以正常加载基础列表', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    expect(assetMocks.listApplications).toHaveBeenCalled()
    expect(wrapper.text()).toContain('www.example.com')
    expect(wrapper.find('[data-testid="asset-professional-workspace"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="asset-professional-card-grid"]').exists()).toBe(true)
  })

  it('应用资产支持确认后手动删除并刷新列表', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((button) => button.text() === '删除')
    expect(deleteButton).toBeTruthy()
    await deleteButton!.trigger('click')
    await flushPromises()

    const confirmInput = wrapper.find('.gc-confirm input')
    expect(confirmInput.exists()).toBe(true)
    await confirmInput.setValue(i18n.global.t('assets.actions.delete'))
    await wrapper.find('.gc-confirm footer .gc-button--danger').trigger('click')
    await flushPromises()

    expect(assetMocks.deleteServiceAsset).toHaveBeenCalledWith('asset-1')
    expect(assetMocks.listApplications).toHaveBeenCalledTimes(2)
  })

  it('应用资产卡片显示所属设备，并继续隐藏框架和站点元数据', async () => {
    assetMocks.listApplications.mockResolvedValue(okPage([
      {
        id: 'asset-name-1',
        address: 'named.example.com',
        displayName: 'named.example.com',
        port: 443,
        protocol: 'HTTPS',
        platform: 'LINUX',
        targetBinding: {
          deviceId: 'host_001',
          deviceDisplayName: 'prod-device',
          frameworkType: 'web.nginx',
          frameworkDisplayName: 'NGINX',
          siteAssetId: 'sit_001',
          siteName: 'prod-site',
        },
        status: 'ACTIVE',
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const card = wrapper.get('[data-testid="asset-professional-card"]')
    expect(card.text()).not.toContain('NGINX')
    expect(card.text()).not.toContain('prod-site')
    expect(card.text()).toContain('prod-device')
    expect(wrapper.text()).not.toContain('sit_001')
    expect(wrapper.text()).not.toContain('host_001')
    expect(assetMocks.listAgents).not.toHaveBeenCalled()
  })

  it('添加应用资产时显示全部证书产物配置', async () => {
    certificateMocks.listCertificateFormats.mockResolvedValue(okPage([
      {
        id: 'certfmt-pem',
        format: 'pem',
        containsPrivateKey: true,
        parameters: { configName: '通用 PEM', systemPlatform: 'windows', runtimePlatform: 'other' },
      },
      {
        id: 'certfmt-pfx',
        format: 'pfx',
        containsPrivateKey: true,
        parameters: { configName: 'Windows IIS PFX', systemPlatform: 'windows', runtimePlatform: 'iis' },
      },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await openProfessionalAssetForm(wrapper)
    const addressInput = wrapper.get('[data-testid="asset-address-input"]')
    await setInputElementValue(addressInput.element as HTMLInputElement, 'pfx.example.com')
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()

    const certificateFormatSelect = wrapper.findAll('select').find((select) => select.find('option[value="certfmt-pfx"]').exists())
    expect(certificateFormatSelect).toBeTruthy()
    expect(certificateFormatSelect!.find('option[value="certfmt-pem"]').exists()).toBe(true)
    expect(certificateFormatSelect!.find('option[value="certfmt-pfx"]').exists()).toBe(true)
  })

  it('应用资产按设备、框架和站点统一选择后创建', async () => {
    assetMocks.listSiteAssets.mockResolvedValue(okPage([
      {
        id: 'site-1',
        serviceInstanceId: 'svc-1',
        siteName: 'default-site',
        providerType: 'NGINX',
      },
    ]))
    assetMocks.listManagedTargets.mockResolvedValue(okPage([{
      id: 'target-1', deviceId: 'host-1', frameworkInstanceId: 'svc-1', siteId: 'site-1', targetType: 'tls.binding', targetKey: 'default-site',
    }]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    await openProfessionalAssetForm(wrapper)

    expect(deviceMocks.listManagedDevices).toHaveBeenCalledWith({
      page: 1,
      pageSize: 200,
      sort: 'displayName:asc',
    })

    const addressInput = wrapper.get('[data-testid="asset-address-input"]')
    await setInputElementValue(addressInput.element as HTMLInputElement, 'app.example.com')

    const nextButton = wrapper.findAll('button').find((button) => button.text() === '下一步')!
    await nextButton.trigger('click')
    await flushPromises()

    const deviceSelect = wrapper.findAll('select').find((select) => select.find('option[value="host-1"]').exists())!
    await deviceSelect.setValue('host-1')
    await flushPromises()

    expect(assetMocks.listFrameworkInstances).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 200,
      sort: 'updatedAt:desc',
      filters: { deviceId: 'host-1', status: 'ACTIVE' },
    })

    const serviceSelect = wrapper.findAll('select').find((select) => select.find('option[value="svc-1"]').exists())!
    await serviceSelect.setValue('svc-1')
    await flushPromises()

    expect(assetMocks.listSiteAssets).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 200,
      sort: 'updatedAt:desc',
      filters: { frameworkInstanceId: 'svc-1', status: 'ACTIVE' },
    })

    const siteSelect = wrapper.findAll('select').find((select) => select.find('option[value="site-1"]').exists())!
    const certificateFormatSelect = wrapper.findAll('select').find((select) => select.find('option[value="certfmt-1"]').exists())!
    await siteSelect.setValue('site-1')
    await certificateFormatSelect.setValue('certfmt-1')
    await flushPromises()

    await nextButton.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '确认创建')!.trigger('click')
    await flushPromises()

    expect(assetMocks.createServiceAsset).toHaveBeenCalledWith(expect.objectContaining({
      deploymentStrategy: expect.objectContaining({
        managedTarget: expect.objectContaining({ certificateFormatId: 'certfmt-1' }),
      }),
    }))
    expect(assetMocks.saveApplicationAssetManagedTarget).toHaveBeenCalledWith('asset-2', expect.objectContaining({
      managedTargetId: 'target-1',
      certificateFormatId: 'certfmt-1',
    }))
    expect(assetMocks.saveApplicationAssetManagedTarget.mock.calls.at(-1)?.[1]).not.toHaveProperty('pluginOverride')
    const payload = assetMocks.createServiceAsset.mock.calls.at(-1)?.[0]
    expect(payload).not.toHaveProperty('agentId')
    expect(payload).not.toHaveProperty('targetBinding')
    expect(payload).not.toHaveProperty('managedTargetId')
  })

  it('插件模式缺少默认能力时必须选择兼容插件后才能继续', async () => {
    assetMocks.getManagedTargetEffectiveCapability.mockRejectedValue(new Error('capability assignment missing'))
    assetMocks.listManagedTargetCompatiblePlugins.mockResolvedValue(okRecord({
      items: [{
        pluginVersionId: 'plugin-version-iis',
        pluginId: 'builtin.windows.iis.pfx',
        version: '1.0.5',
        runtime: 'AGENT_ATOMIC',
        displayName: 'IIS PFX 证书部署',
        compatible: true,
        executionLocations: ['AGENT'],
      }],
    }))
    assetMocks.listFrameworkInstances.mockResolvedValue(okPage([{
      id: 'svc-iis-1', displayName: 'Microsoft IIS', frameworkType: 'web.iis', deviceId: 'host-1',
    }]))
    assetMocks.listSiteAssets.mockResolvedValue(okPage([{
      id: 'site-iis-1', frameworkInstanceId: 'svc-iis-1', deviceId: 'host-1', siteName: 'TEST', port: 4433, protocol: 'HTTPS',
    }]))
    assetMocks.listManagedTargets.mockResolvedValue(okPage([{
      id: 'target-iis-1', deviceId: 'host-1', frameworkInstanceId: 'svc-iis-1', siteId: 'site-iis-1', targetType: 'tls.binding', targetKey: '*:4433:',
    }]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await openProfessionalAssetForm(wrapper)
    const addressInput = wrapper.get('[data-testid="asset-address-input"]')
    await setInputElementValue(addressInput.element as HTMLInputElement, 'iis.example.com')
    const nextButton = wrapper.findAll('button').find((button) => button.text() === '下一步')!
    await nextButton.trigger('click')
    await flushPromises()
    await wrapper.findAll('select').find((select) => select.find('option[value="host-1"]').exists())!.setValue('host-1')
    await flushPromises()
    await wrapper.findAll('select').find((select) => select.find('option[value="svc-iis-1"]').exists())!.setValue('svc-iis-1')
    await flushPromises()
    await wrapper.findAll('select').find((select) => select.find('option[value="site-iis-1"]').exists())!.setValue('site-iis-1')
    await wrapper.findAll('select').find((select) => select.find('option[value="certfmt-1"]').exists())!.setValue('certfmt-1')
    await flushPromises()

    const pluginSelect = wrapper.findAll('select').find((select) => select.find('option[value="plugin-version-iis"]').exists())!
    const targetStepNextButton = wrapper.findAll('button').find((button) => button.text() === '下一步')!
    expect(pluginSelect.attributes('required')).toBeDefined()
    expect(targetStepNextButton.attributes('disabled')).toBeDefined()
    await pluginSelect.setValue('plugin-version-iis')
    await flushPromises()
    expect(wrapper.text()).not.toContain('当前目标尚未配置生效的部署能力。')
    expect(wrapper.text()).toContain('保存后将创建应用资产级部署能力指派。')
    expect(wrapper.text()).toContain('AGENT_ATOMIC')
    expect(wrapper.text()).toContain('AGENT')
    const enabledTargetStepNextButton = wrapper.findAll('button').find((button) => button.text() === '下一步')!
    expect(enabledTargetStepNextButton.attributes('disabled')).toBeUndefined()
    await enabledTargetStepNextButton.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '确认创建')!.trigger('click')
    await flushPromises()

    expect(assetMocks.saveApplicationAssetManagedTarget).toHaveBeenCalledWith('asset-2', expect.objectContaining({
      managedTargetId: 'target-iis-1',
      pluginOverride: expect.objectContaining({
        pluginVersionId: 'plugin-version-iis',
        inputBindings: {
          apiVersion: 'gcac.input-bindings/v1',
          variables: {},
          connections: {},
          credentials: {},
          artifacts: {},
        },
      }),
    }))
  })

  it('统一设备列表加载失败时显示错误而不是静默空列表', async () => {
    deviceMocks.listManagedDevices.mockRejectedValueOnce(new Error('device list unavailable'))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await openProfessionalAssetForm(wrapper)

    expect(wrapper.text()).toContain('device list unavailable')
  })

  it('编辑 ADC 应用资产时加载并允许修改受管目标链路', async () => {
    assetMocks.getManagedTargetEffectiveCapability.mockImplementation((
      _managedTargetId: string,
      _capabilityKey: string,
      applicationAssetId?: string,
    ) => applicationAssetId
      ? okRecord({
        capabilityKey: 'certificate.deploy',
        source: { ownerType: 'MANAGED_TARGET', ownerId: 'target-adc-1', precedence: 'TARGET_OVERRIDE' },
        plugin: {
          pluginVersionId: 'plugin-version-adc-1',
          pluginId: 'citrix.netscaler-adc',
          version: '1.1.29',
          runtime: 'WORKFLOW_DSL',
          displayName: 'Citrix ADC 证书部署',
        },
        binding: { pluginBindingId: 'binding-adc-1', status: 'ACTIVE', version: 1 },
        executionLocation: 'CONTROL_PLANE',
        compatible: true,
      })
      : okRecord({
        capabilityKey: 'certificate.deploy',
        source: { ownerType: 'MANAGED_TARGET', ownerId: 'target-adc-1', precedence: 'TARGET_OVERRIDE' },
        plugin: { pluginVersionId: 'plugin-version-default', pluginId: 'builtin.windows.iis.pfx', runtime: 'AGENT_ATOMIC' },
        binding: { pluginBindingId: 'binding-default', status: 'ACTIVE', version: 1 },
        executionLocation: 'AGENT',
      }))
    assetMocks.listManagedTargetCompatiblePlugins.mockResolvedValue(okRecord({
      items: [{
        pluginVersionId: 'plugin-version-apache-1',
        pluginId: 'builtin.workflow.apache-8444-cert-switch',
        version: '1.2.6',
        runtime: 'WORKFLOW_DSL',
        displayName: 'Apache HTTPS 证书部署',
        compatible: true,
      }, {
        pluginVersionId: 'plugin-version-synology-1',
        pluginId: 'builtin.workflow.synology-dsm-cert-import',
        version: '1.2.5',
        runtime: 'WORKFLOW_DSL',
        displayName: 'Synology DSM 证书部署',
        compatible: true,
      }],
    }))
    assetMocks.getApplicationDetail.mockResolvedValue(okRecord({
      id: 'asset-1',
      address: '10.255.0.41',
      displayName: 'test',
      port: 443,
      protocol: 'HTTPS',
      platform: 'APPLIANCE',
      verifyUrl: 'https://10.255.0.41/health',
      environment: 'prod',
      targetBinding: {
        managedTargetId: 'target-adc-1',
      },
      targetBindingDetail: {
        host: { id: 'host-adc-1', displayName: 'ADC 01' },
        frameworkInstance: { id: 'svc-adc-1', deviceId: 'host-adc-1', displayName: 'netscaler-adc', frameworkType: 'adc.load-balancer' },
        siteAsset: { id: 'site-adc-1', deviceId: 'host-adc-1', frameworkInstanceId: 'svc-adc-1', siteName: 'test', bindingInformation: '10.255.0.41:443' },
        managedTarget: {
          id: 'target-adc-1',
          deviceId: 'host-adc-1',
          frameworkInstanceId: 'svc-adc-1',
          siteId: 'site-adc-1',
          targetType: 'tls.binding',
          targetKey: 'LB:test',
          bindingKey: 'LB:test',
          status: 'UNREACHABLE',
        },
      },
      metadata: {
        deploymentStrategy: {
          type: 'MANAGED_TARGET',
          managedTarget: {
            managedTargetId: 'target-adc-1',
            certificateFormatId: 'certfmt-1',
          },
        },
      },
    }))
    assetMocks.listFrameworkInstances.mockResolvedValue(okPage([
      { id: 'svc-adc-1', displayName: 'netscaler-adc', frameworkType: 'adc.load-balancer', deviceId: 'host-adc-1' },
    ]))
    assetMocks.listSiteAssets.mockResolvedValue(okPage([
      { id: 'site-adc-1', frameworkInstanceId: 'svc-adc-1', deviceId: 'host-adc-1', siteName: 'test', bindingInformation: '10.255.0.41:443' },
    ]))
    assetMocks.listManagedTargets.mockResolvedValue(okPage([]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()

    const verifyUrlInput = wrapper.findAll('input').find((input) => input.attributes('placeholder') === '例如：https://example.com/health')
    const environmentInput = wrapper.findAll('input').find((input) => input.attributes('placeholder') === 'prod / staging')
    expect(verifyUrlInput?.element.value).toBe('https://10.255.0.41/health')
    expect(environmentInput?.element.value).toBe('prod')

    expect(deviceMocks.listManagedDevices).toHaveBeenCalledWith(expect.objectContaining({ sort: 'displayName:asc' }))
    expect(assetMocks.listFrameworkInstances).toHaveBeenCalledWith(expect.objectContaining({ filters: { deviceId: 'host-adc-1', status: 'ACTIVE' } }))
    expect(assetMocks.listSiteAssets).toHaveBeenCalledWith(expect.objectContaining({ filters: { frameworkInstanceId: 'svc-adc-1', status: 'ACTIVE' } }))
    expect(assetMocks.listManagedTargets).toHaveBeenCalledWith(expect.objectContaining({ filters: { siteId: 'site-adc-1', status: 'ACTIVE' } }))
    expect(assetMocks.listManagedTargetCompatiblePlugins).toHaveBeenCalledWith('target-adc-1', 'certificate.deploy', 'asset-1', 'zh-CN')

    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()
    const deviceSelect = wrapper.findAll('select').find((select) => select.find('option[value="host-adc-1"]').exists())
    const targetSelect = wrapper.findAll('select').find((select) => select.find('option[value="target-adc-1"]').exists())
    const certificateFormatSelect = wrapper.findAll('select').find((select) => select.find('option[value="certfmt-1"]').exists())
    expect(deviceSelect?.element.value).toBe('host-adc-1')
    expect(targetSelect?.element.value).toBe('target-adc-1')
    expect(certificateFormatSelect?.element.value).toBe('certfmt-1')
    expect(wrapper.text()).toContain('test（10.255.0.41:443）')
    expect(wrapper.text()).toContain('Citrix ADC 证书部署')
    expect(wrapper.text()).not.toContain('plugin.citrix.name')
    expect(deviceSelect?.classes()).toContain('gc-native-select')

    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '保存修改')!.trigger('click')
    await flushPromises()

    expect(assetMocks.updateServiceAsset).toHaveBeenCalledWith('asset-1', expect.objectContaining({
      verifyUrl: 'https://10.255.0.41/health',
      environment: 'prod',
    }))
    expect(assetMocks.updateServiceAsset).toHaveBeenCalledWith('asset-1', expect.not.objectContaining({ hostId: expect.anything(), serviceInstanceId: expect.anything(), targetBinding: expect.anything() }))
    expect(assetMocks.saveApplicationAssetManagedTarget).toHaveBeenCalledWith('asset-1', expect.objectContaining({
      managedTargetId: 'target-adc-1',
      certificateFormatId: 'certfmt-1',
    }))
  })

  it('插件部署输入变更后重新投影，布尔值 true 不再保留旧的缺失错误', async () => {
    assetMocks.getApplicationDetail.mockResolvedValue(okRecord({
      id: 'asset-1',
      address: '10.255.0.41',
      displayName: 'test',
      port: 443,
      protocol: 'HTTPS',
      platform: 'APPLIANCE',
      targetBindingDetail: {
        host: { id: 'host-adc-1', displayName: 'ADC 01' },
        frameworkInstance: { id: 'svc-adc-1', deviceId: 'host-adc-1', displayName: 'netscaler-adc', frameworkType: 'adc.load-balancer' },
        siteAsset: { id: 'site-adc-1', deviceId: 'host-adc-1', frameworkInstanceId: 'svc-adc-1', siteName: 'test', bindingInformation: '10.255.0.41:443' },
        managedTarget: { id: 'target-adc-1', deviceId: 'host-adc-1', frameworkInstanceId: 'svc-adc-1', siteId: 'site-adc-1', targetType: 'tls.binding', targetKey: 'LB:test' },
      },
      deploymentStrategy: {
        type: 'MANAGED_TARGET',
        managedTarget: { managedTargetId: 'target-adc-1', certificateFormatId: 'certfmt-1', executionMode: 'PLUGIN' },
      },
    }))
    assetMocks.listFrameworkInstances.mockResolvedValue(okPage([
      { id: 'svc-adc-1', displayName: 'netscaler-adc', frameworkType: 'adc.load-balancer', deviceId: 'host-adc-1' },
    ]))
    assetMocks.listSiteAssets.mockResolvedValue(okPage([
      { id: 'site-adc-1', frameworkInstanceId: 'svc-adc-1', deviceId: 'host-adc-1', siteName: 'test', bindingInformation: '10.255.0.41:443' },
    ]))
    assetMocks.listManagedTargets.mockResolvedValue(okPage([
      { id: 'target-adc-1', deviceId: 'host-adc-1', frameworkInstanceId: 'svc-adc-1', siteId: 'site-adc-1', targetType: 'tls.binding', targetKey: 'LB:test' },
    ]))
    deploymentInputMocks.projectApplicationAssetPluginInputs.mockImplementation(async (_managedTargetId: string, payload: { inputBindings?: { variables?: Record<string, unknown> } }) => {
      const configured = payload.inputBindings?.variables?.allowInsecureTls === true
      return okRecord({
        contractVersion: 'gcac.deployment-input-contract/v1',
        requiredVariables: [{
          slot: 'allowInsecureTls',
          type: 'boolean',
          required: true,
          configurationMode: 'required',
          bindingPolicy: 'required_binding',
          source: { kind: 'binding' },
          descriptionKey: 'deploymentInputs.allowInsecureTls.description',
          ui: { labelKey: 'deploymentInputs.allowInsecureTls.label', helpKey: 'deploymentInputs.allowInsecureTls.help' },
          ...(configured ? { value: true } : {}),
        }],
        advancedVariables: [],
        connections: [],
        credentials: [],
        artifacts: [],
        fixedValues: [],
        runtimeValues: [],
        issues: configured ? [] : [{
          category: 'VARIABLE',
          code: 'DEPLOYMENT_INPUT_REQUIRED',
          severity: 'ERROR',
          slot: 'allowInsecureTls',
          path: 'variables.allowInsecureTls',
          messageKey: 'deploymentInputs.issues.DEPLOYMENT_INPUT_REQUIRED',
        }],
        saveable: configured,
      })
    })

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('缺少必填部署输入')
    const field = wrapper.findAll('label').find((label) => label.text().includes('允许跳过 TLS 证书校验'))
    expect(field).toBeTruthy()
    await field!.find('select').setValue('true')
    await flushPromises()

    expect(deploymentInputMocks.projectApplicationAssetPluginInputs.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      inputBindings: expect.objectContaining({
        variables: expect.objectContaining({ allowInsecureTls: true }),
      }),
    }))
    expect(wrapper.text()).not.toContain('缺少必填部署输入')
  })

  it('编辑插件 Host 时在后台投影期间保留输入框和焦点', async () => {
    assetMocks.getApplicationDetail.mockResolvedValue(okRecord({
      id: 'asset-1',
      address: '10.255.0.41',
      displayName: 'test',
      port: 443,
      protocol: 'HTTPS',
      platform: 'APPLIANCE',
      targetBindingDetail: {
        host: { id: 'host-adc-1', displayName: 'ADC 01' },
        frameworkInstance: { id: 'svc-adc-1', deviceId: 'host-adc-1', displayName: 'netscaler-adc', frameworkType: 'adc.load-balancer' },
        siteAsset: { id: 'site-adc-1', deviceId: 'host-adc-1', frameworkInstanceId: 'svc-adc-1', siteName: 'test', bindingInformation: '10.255.0.41:443' },
        managedTarget: { id: 'target-adc-1', deviceId: 'host-adc-1', frameworkInstanceId: 'svc-adc-1', siteId: 'site-adc-1', targetType: 'tls.binding', targetKey: 'LB:test' },
      },
      deploymentStrategy: {
        type: 'MANAGED_TARGET',
        managedTarget: { managedTargetId: 'target-adc-1', certificateFormatId: 'certfmt-1', executionMode: 'PLUGIN' },
      },
    }))
    assetMocks.listFrameworkInstances.mockResolvedValue(okPage([
      { id: 'svc-adc-1', displayName: 'netscaler-adc', frameworkType: 'adc.load-balancer', deviceId: 'host-adc-1' },
    ]))
    assetMocks.listSiteAssets.mockResolvedValue(okPage([
      { id: 'site-adc-1', frameworkInstanceId: 'svc-adc-1', deviceId: 'host-adc-1', siteName: 'test', bindingInformation: '10.255.0.41:443' },
    ]))
    assetMocks.listManagedTargets.mockResolvedValue(okPage([
      { id: 'target-adc-1', deviceId: 'host-adc-1', frameworkInstanceId: 'svc-adc-1', siteId: 'site-adc-1', targetType: 'tls.binding', targetKey: 'LB:test' },
    ]))

    let resolveHostProjection: (() => void) | undefined
    deploymentInputMocks.projectApplicationAssetPluginInputs.mockImplementation(async (
      _managedTargetId: string,
      payload: { inputBindings?: { connections?: Record<string, { host?: string }> } },
    ) => {
      const host = payload.inputBindings?.connections?.management?.host ?? '1'
      const response = okRecord({
        contractVersion: 'gcac.deployment-input-contract/v1',
        requiredVariables: [],
        advancedVariables: [],
        connections: [{
          slot: 'management',
          transport: 'http',
          credentialSlot: 'credential',
          fields: {
            host: {
              slot: 'host',
              type: 'string',
              required: true,
              configurationMode: 'required',
              bindingPolicy: 'required_binding',
              source: { kind: 'binding' },
              value: host,
            },
          },
        }],
        credentials: [],
        artifacts: [],
        fixedValues: [],
        runtimeValues: [],
        issues: [],
        saveable: true,
      })
      if (host !== '10.255.0.49') return response
      return new Promise((resolve) => {
        resolveHostProjection = () => resolve(response)
      })
    })

    const wrapper = mountBusinessView(AssetsView)
    document.body.append(wrapper.element)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()

    expect(deploymentInputMocks.projectApplicationAssetPluginInputs).toHaveBeenCalled()
    expect(wrapper.text()).toContain('management')
    const hostInput = wrapper.find('input[value="1"]')
    expect(hostInput.exists()).toBe(true)
    const hostElement = hostInput.element as HTMLInputElement
    hostElement.focus()
    expect(document.activeElement).toBe(hostElement)

    await hostInput.setValue('10.255.0.49')
    await wrapper.vm.$nextTick()

    const activeHostInput = wrapper.find('input[value="10.255.0.49"]')
    expect(activeHostInput.exists()).toBe(true)
    expect(activeHostInput.element).toBe(hostElement)
    expect(document.activeElement).toBe(hostElement)
    expect(resolveHostProjection).toBeTypeOf('function')

    resolveHostProjection!()
    await flushPromises()

    expect(wrapper.find('input[value="10.255.0.49"]').element).toBe(hostElement)
    expect(document.activeElement).toBe(hostElement)
  })

  it('应用资产可以按工作流模式创建并保存部署策略', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    await openProfessionalAssetForm(wrapper)

    const workflowModeButton = wrapper.findAll('button').find((button) => button.text().includes('独立工作流'))
    expect(workflowModeButton).toBeTruthy()
    await workflowModeButton!.trigger('click')
    await flushPromises()

    const addressInput = wrapper.find('[data-testid="asset-address-input"]')
    expect(addressInput).toBeTruthy()
    await setInputElementValue(addressInput!.element as HTMLInputElement, 'app.example.com')

    const nextButton = wrapper.findAll('button').find((button) => button.text() === '下一步')
    expect(nextButton).toBeTruthy()
    await nextButton!.trigger('click')
    await flushPromises()

    const workflowSelect = wrapper.findAll('select').find((select) => select.find('option[value="workflow-1"]').exists())
    expect(workflowSelect).toBeTruthy()
    await workflowSelect!.setValue('workflow-1')
    await flushPromises()

    const versionSelect = wrapper.findAll('select').find((select) => select.find('option[value="workflow-version-1"]').exists())
    expect(versionSelect).toBeTruthy()
    await versionSelect!.setValue('workflow-version-1')
    await flushPromises()

    expect(wrapper.text()).toContain('请先保存应用资产及执行来源')
    expect(wrapper.text()).not.toContain('运行变量 JSON')
    expect(wrapper.text()).not.toContain('deviceHost')
    expect(wrapper.text()).not.toContain('证书变量绑定')

    await nextButton!.trigger('click')
    await flushPromises()

    const saveButton = wrapper.findAll('button').find((button) => button.text() === '确认创建')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(assetMocks.createServiceAsset).toHaveBeenCalledWith(expect.objectContaining({
      address: 'app.example.com',
      port: 443,
      protocol: 'HTTPS',
      deploymentStrategy: expect.objectContaining({
        type: 'WORKFLOW',
        workflow: expect.objectContaining({
          workflowId: 'workflow-1',
          workflowVersionId: 'workflow-version-1',
          runner: 'CONTROL_PLANE',
          gatewayId: undefined,
          target: expect.objectContaining({
            verifyUrl: 'https://app.example.com:443',
          }),
          inputBindings: {
            apiVersion: 'gcac.input-bindings/v1',
            variables: {},
            connections: {},
            credentials: {},
            artifacts: {},
          },
        }),
      }),
    }))
    expect(assetMocks.createServiceAsset.mock.calls[0][0].deploymentStrategy.workflow.inputBindings.variables).not.toHaveProperty('deviceHost')
    expect(assetMocks.createServiceAsset.mock.calls[0][0].deploymentStrategy.workflow.inputBindings.variables).not.toHaveProperty('serverCert')
    expect(assetMocks.createServiceAsset.mock.calls[0][0]).not.toHaveProperty('targetBinding')
    expect(assetMocks.createServiceAsset.mock.calls[0][0]).not.toHaveProperty('agentId')
  })

  it('应用资产选择工作流时隐藏非证书部署的插件工作流', async () => {
    workflowMocks.listWorkflowTemplates.mockResolvedValue(okPage([
      { id: 'workflow-deploy', name: 'Synology 证书部署', origin: 'plugin_internal', capabilities: ['certificate.deploy', 'certificate.rollback'] },
      { id: 'workflow-discover', name: 'Synology 设备发现', origin: 'plugin_internal', capabilities: ['device.discover'] },
      { id: 'workflow-user', name: '自定义证书部署', origin: 'user', capabilities: [] },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await openProfessionalAssetForm(wrapper)
    await wrapper.findAll('button').find((button) => button.text().includes('独立工作流'))!.trigger('click')
    await flushPromises()
    await setInputElementValue(wrapper.get('[data-testid="asset-address-input"]').element as HTMLInputElement, 'test-workflow.jacksonz.cn')
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()

    const workflowSelect = wrapper.findAll('select').find((select) => select.find('option[value="workflow-deploy"]').exists())
    expect(workflowSelect).toBeTruthy()
    expect(workflowSelect!.find('option[value="workflow-discover"]').exists()).toBe(false)
    expect(workflowSelect!.find('option[value="workflow-user"]').exists()).toBe(true)
  })

  it('应用资产选择插件内置工作流时按 DSL SemVer 展示并合并重复版本', async () => {
    workflowMocks.listWorkflowTemplates.mockResolvedValue(okPage([{
      id: 'workflow-apache',
      name: 'apache-8444-cert-switch',
      origin: 'plugin_internal',
      capabilities: ['certificate.deploy', 'certificate.rollback'],
      currentVersionId: 'workflow-version-126',
      currentVersionLabel: '1.2.6',
    }]))
    workflowMocks.listWorkflowTemplateVersions.mockResolvedValue({
      data: {
        items: [
          {
            id: 'workflow-version-126',
            version: 2,
            status: 'published',
            templateId: 'workflow-apache',
            createdAt: '2026-08-02T22:48:31.000Z',
            content: { metadata: { version: '1.2.6' }, inputContract: { variables: {}, connections: {}, credentials: {}, artifacts: {} } },
          },
          {
            id: 'workflow-version-126-duplicate',
            version: 8,
            status: 'published',
            templateId: 'workflow-apache-legacy',
            createdAt: '2026-08-02T21:00:00.000Z',
            content: { metadata: { version: '1.2.6' }, inputContract: { variables: {}, connections: {}, credentials: {}, artifacts: {} } },
          },
          {
            id: 'workflow-version-124',
            version: 4,
            status: 'published',
            templateId: 'workflow-apache-legacy',
            createdAt: '2026-08-01T21:11:56.000Z',
            content: { metadata: { version: '1.2.4' }, inputContract: { variables: {}, connections: {}, credentials: {}, artifacts: {} } },
          },
        ],
      },
      requestId: 'req_workflow_versions',
      timestamp: '2026-08-02T22:48:31.000Z',
    })

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await openProfessionalAssetForm(wrapper)
    await wrapper.findAll('button').find((button) => button.text().includes('独立工作流'))!.trigger('click')
    await flushPromises()
    await setInputElementValue(
      wrapper.get('[data-testid="asset-address-input"]').element as HTMLInputElement,
      'test03.jacksonz.cn',
    )
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()

    const workflowSelect = wrapper.findAll('select').find((select) => select.find('option[value="workflow-apache"]').exists())
    expect(workflowSelect).toBeTruthy()
    await workflowSelect!.setValue('workflow-apache')
    await flushPromises()

    const versionSelect = wrapper.findAll('select').find((select) => select.find('option[value="workflow-version-126"]').exists())
    expect(versionSelect).toBeTruthy()
    expect(versionSelect!.findAll('option').map((option) => option.text())).toEqual(['请选择已发布版本', '1.2.6', '1.2.4'])
    expect(versionSelect!.find('option[value="workflow-version-126-duplicate"]').exists()).toBe(false)
    expect(versionSelect!.text()).not.toMatch(/(^|\s)[1248](\s|$)/)
  })

  it('工作流投影中的 credential 必须渲染为凭据选择器', async () => {
    assetMocks.getApplicationDetail.mockResolvedValue(okRecord({
      id: 'asset-1', address: 'cloud.jacksonz.cn', port: 443, protocol: 'HTTPS', platform: 'LINUX',
      deploymentStrategy: { type: 'WORKFLOW', workflow: { workflowId: 'workflow-1', workflowVersionSelection: 'PINNED', workflowVersionId: 'workflow-version-1', runner: 'CONTROL_PLANE', inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} } } },
    }))
    deploymentInputMocks.projectDeploymentInputs.mockResolvedValue(okRecord({
      contractVersion: 'gcac.deployment-input-contract/v1', requiredVariables: [], advancedVariables: [], connections: [],
      credentials: [{ slot: 'synologyCredential', allowedKinds: ['USERNAME_PASSWORD'], required: true, configurationMode: 'required' }],
      artifacts: [], fixedValues: [], runtimeValues: [], issues: [], saveable: false,
    }))
    workflowMocks.listWorkflowTemplateVersions.mockResolvedValue({
      data: {
        items: [{
          id: 'workflow-version-1',
          version: 'v1',
          status: 'published',
          templateId: 'workflow-1',
          content: {
            inputContract: {
              apiVersion: 'gcac.deployment-input/v1',
              variables: {},
              connections: {},
              credentials: { synologyCredential: { required: true, configurationMode: 'required', lifecycle: 'pre_execution', allowedKinds: ['USERNAME_PASSWORD'] } },
              artifacts: { serverCert: { kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution', artifactContract: { outputs: {} } } },
            },
          },
        }],
      },
      requestId: 'req_workflow_versions', timestamp: '2026-07-22T00:00:00.000Z',
    })
    securityMocks.listSecrets.mockResolvedValue(okPage([{ id: 'sec_synology', name: 'DSM 管理凭据', type: 'password', metadata: { workflowCredential: true, workflowCredentialKind: 'username_password', username: 'admin' } }]))
    credentialMocks.listCredentials.mockResolvedValue(okPage([{ id: 'sec_synology', status: 'active' }]))
    credentialMocks.getCredential.mockResolvedValue(okRecord({
      id: 'sec_synology',
      name: 'DSM 管理凭据',
      kind: 'USERNAME_PASSWORD',
      username: 'admin',
      secretSlots: {},
      createdAt: '2026-07-22T00:00:00.000Z',
    }))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('选择工作流版本、运行位置和变量，证书变量会在运行时注入。')
    expect(wrapper.text()).toContain('选择工作流')
    expect(wrapper.text()).toContain('版本更新方式')
    const targetSection = wrapper.find('section[aria-label="应用资产属性"]')
    expect(targetSection.exists()).toBe(true)
    const basicTargetLabels = targetSection.findAll('label > span').map((label) => label.text())
    expect(basicTargetLabels).not.toContain('端口 *')
    expect(basicTargetLabels).not.toContain('协议 *')
    expect(basicTargetLabels).not.toContain('验证 URL')
    expect(targetSection.text()).not.toContain('服务监听规则')
    await targetSection.findAll('button').find((button) => button.text() === '展开高级设置')!.trigger('click')
    await flushPromises()
    const expandedTargetSection = wrapper.find('section[aria-label="应用资产属性"]')
    expect(expandedTargetSection.text()).toContain('服务监听规则')
    expect(expandedTargetSection.text()).toContain('访问请求域名')
    expect(expandedTargetSection.text()).toContain('TLS 证书域名')

    const credentialSelect = wrapper.findAll('select').find((select) => select.find('option[value="sec_synology"]').exists())
    expect(credentialSelect).toBeTruthy()
    expect(wrapper.find('input[value="sec_synology"]').exists()).toBe(false)
    const projectionCall = deploymentInputMocks.projectDeploymentInputs.mock.calls.at(-1)
    expect(projectionCall?.[1]).toMatchObject({
      workflowTemplateId: 'workflow-1',
      workflowVersionId: 'workflow-version-1',
    })
  })

  it('编辑工作流应用资产时会回填并保留证书产物绑定', async () => {
    deploymentInputMocks.projectDeploymentInputs.mockResolvedValue(okRecord({
      contractVersion: 'gcac.deployment-input-contract/v1', requiredVariables: [], advancedVariables: [], connections: [], credentials: [],
      artifacts: [{ slot: 'serverCert', kind: 'certificate', required: true, configurationMode: 'required', outputs: { certFile: { role: 'public_certificate', required: true }, keyFile: { role: 'private_key', required: true } }, binding: { certificateFormatId: 'certfmt-1', outputBindings: { certFile: 'fullchain', keyFile: 'private' } } }],
      fixedValues: [], runtimeValues: [], issues: [], saveable: true,
    }))
    assetMocks.getApplicationDetail.mockResolvedValue(okRecord({
      id: 'asset-1',
      address: 'app.example.com',
      port: 443,
      protocol: 'HTTPS',
      platform: 'LINUX',
      metadata: {
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: 'workflow-1',
            workflowVersionId: 'workflow-version-1',
            runner: 'CONTROL_PLANE',
            inputBindings: {
              apiVersion: 'gcac.input-bindings/v1',
              variables: {
                deviceHost: 'app.example.com',
                verifyUrl: 'https://app.example.com/custom-health',
              },
              connections: {},
              credentials: {},
              artifacts: {
                serverCert: {
                  certificateFormatId: 'certfmt-1',
                  outputBindings: {
                    certFile: 'fullchain',
                    keyFile: 'private',
                  },
                },
              },
            },
          },
        },
      },
    }))
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const editButton = wrapper.findAll('button').find((button) => button.text() === '编辑')
    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')
    await flushPromises()

    const firstNextButton = wrapper.findAll('button').find((button) => button.text() === '下一步')
    expect(firstNextButton).toBeTruthy()
    await firstNextButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('https://app.example.com/custom-health')
    expect(wrapper.text()).not.toContain('https://nas.example.com:5001/')

    const selects = wrapper.findAll('select')
    expect(selects.some((select) => select.find('option[value="workflow-1"]').text() === 'Apache 证书替换')).toBe(true)
    expect(selects.some((select) => select.element.value === 'certfmt-1')).toBe(true)
    expect(selects.some((select) => select.element.value === 'fullchain')).toBe(true)
    expect(selects.some((select) => select.element.value === 'private')).toBe(true)
    await selects.find((select) => select.find('option[value="LATEST_PUBLISHED"]').exists())!.setValue('LATEST_PUBLISHED')
    await flushPromises()

    const secondNextButton = wrapper.findAll('button').find((button) => button.text() === '下一步')
    expect(secondNextButton).toBeTruthy()
    await secondNextButton!.trigger('click')
    await flushPromises()

    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存修改')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(assetMocks.updateServiceAsset).toHaveBeenCalledWith('asset-1', expect.objectContaining({
      metadata: expect.objectContaining({
        workflowTarget: expect.objectContaining({ verifyUrl: 'https://app.example.com:443' }),
      }),
    }))
    expect(assetMocks.saveApplicationAssetStandaloneWorkflow).toHaveBeenCalledWith('asset-1', {
      workflowExecution: expect.objectContaining({
        workflowTemplateId: 'workflow-1',
        workflowVersionSelection: 'FIXED',
        workflowVersionId: 'workflow-version-1',
        inputBindings: {
          apiVersion: 'gcac.input-bindings/v1',
          variables: {},
          connections: {},
          credentials: {},
          artifacts: {
            serverCert: {
              certificateFormatId: 'certfmt-1',
              outputBindings: {
                certFile: 'fullchain',
                keyFile: 'private',
              },
            },
          },
        },
      }),
    })
    const savedWorkflowExecution = assetMocks.saveApplicationAssetStandaloneWorkflow.mock.calls.at(-1)?.[1]?.workflowExecution
    expect(savedWorkflowExecution).toHaveProperty('workflowVersionId', 'workflow-version-1')
  })

  it('证书产物页展示真实内容格式与包含内容', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    expect(certificateMocks.listCertificateFormats).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 200,
      sort: 'createdAt:desc',
    }))
    expect(wrapper.text()).toContain('Windows-设备兼容单文件PEM模板')
    expect(wrapper.text()).toContain('PEM 单文件 Bundle')
    expect(wrapper.text()).toContain('终端证书 · 证书链 · 私钥')
  })

  it('可为交付配置选择证书版本并导出对应格式', async () => {
    const createObjectUrl = vi.fn(() => 'blob:test')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const exportButton = wrapper.findAll('button').find((button) => button.text() === '导出')
    expect(exportButton).toBeTruthy()
    await exportButton!.trigger('click')
    await flushPromises()

    expect(certificateMocks.listCertificateVersions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 200 }))
    expect(certificateMocks.listCertificates).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 200 }))
    const versionSelect = wrapper.findAll('select').find((select) => select.find('option[value="certver-1"]').exists())
    expect(versionSelect).toBeTruthy()
    await versionSelect!.setValue('certver-1')
    const confirmButton = wrapper.findAll('button').find((button) => button.text() === '生成并下载')
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(certificateMocks.exportCertificateFormatArtifact).toHaveBeenCalledWith(expect.objectContaining({
      certificateFormatId: 'certfmt-1',
      certificateVersionId: 'certver-1',
      format: 'pem',
    }))
    expect(certificateMocks.downloadCertificateFormatArtifact).toHaveBeenCalledWith('artifact://certificate-format/certfmt-1/test')
    expect(createObjectUrl).toHaveBeenCalled()
    expect(anchorClick).toHaveBeenCalled()
    anchorClick.mockRestore()
  })

  it('导出 PFX 时必须输入本次密码并使用临时 SecretRef', async () => {
    certificateMocks.listCertificateFormats.mockResolvedValue(okPage([
      {
        id: 'certfmt-pfx',
        format: 'pfx',
        containsPrivateKey: true,
        parameters: {
          configName: 'Windows PFX',
          outputPreset: 'pfx',
          extension: 'pfx',
          includePrivateKey: true,
        },
      },
    ]))
    certificateMocks.exportCertificateFormatArtifact.mockResolvedValue(okRecord({ artifactRef: 'artifact://certificate-format/certfmt-pfx/test' }, 'req_pfx_export'))
    certificateMocks.downloadCertificateFormatArtifact.mockResolvedValue(new Response(Buffer.from('pfx'), { status: 200, headers: { 'content-type': 'application/x-pkcs12' } }))
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '导出')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('select').find((select) => select.find('option[value="certver-1"]').exists())!.setValue('certver-1')

    const confirmButton = wrapper.findAll('button').find((button) => button.text() === '生成并下载')!
    await confirmButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('PFX/JKS 导出必须输入密码')
    expect(certificateMocks.exportCertificateFormatArtifact).not.toHaveBeenCalled()

    const passwordInput = wrapper.find('input[type="password"]')
    expect(passwordInput.exists()).toBe(true)
    await passwordInput.setValue('export-password')
    await confirmButton.trigger('click')
    await flushPromises()
    expect(securityMocks.createSecret).toHaveBeenCalledWith(expect.objectContaining({ plainText: 'export-password', type: 'pfx_password' }))
    expect(certificateMocks.exportCertificateFormatArtifact).toHaveBeenCalledWith(expect.objectContaining({
      certificateFormatId: 'certfmt-pfx',
      passwordSecretRef: 'secret://pfx_password/export-1#current',
    }))
    expect(anchorClick).toHaveBeenCalled()
    const downloadedAnchor = anchorClick.mock.instances.at(-1) as HTMLAnchorElement | undefined
    expect(downloadedAnchor?.download).toBe('windows-pfx.pfx')
    anchorClick.mockRestore()
  })

  it('可以创建设备兼容单文件 PEM Bundle 并选择终端证书、证书链、私钥', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建交付配置')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const systemSelect = wrapper.findAll('select').find((select) => select.find('option[value="windows"]').exists())
    expect(systemSelect).toBeTruthy()
    await systemSelect!.setValue('windows')
    await flushPromises()

    const runtimeInput = wrapper.find('[data-testid="runtime-platform-input"]')
    expect(runtimeInput.exists()).toBe(true)
    await runtimeInput.setValue('other')
    await flushPromises()

    const applyButton = wrapper.findAll('button').find((button) => button.text() === '套用内置模板')
    expect(applyButton).toBeTruthy()
    await applyButton!.trigger('click')
    await flushPromises()

    const nameInput = wrapper.findAll('input').find((input) => input.attributes('placeholder')?.includes('设备兼容单文件PEM'))
    expect(nameInput).toBeTruthy()
    await setInputElementValue(nameInput!.element as HTMLInputElement, '设备兼容CRT单文件模板')

    const extensionInput = wrapper.findAll('input').find((input) => input.attributes('placeholder')?.includes('pem'))
    expect(extensionInput).toBeTruthy()
    await setInputElementValue(extensionInput!.element as HTMLInputElement, 'crt')

    const includePrivateKey = wrapper.findAll('input[type=\"checkbox\"]').find((input) => input.element.nextSibling?.textContent?.includes('包含私钥'))
    expect(includePrivateKey).toBeTruthy()
    if (!(includePrivateKey!.element as HTMLInputElement).checked) {
      await includePrivateKey!.setValue(true)
    }

    const saveButton = wrapper.findAll('button').find((button) => button.text() === '确认保存')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(certificateMocks.createCertificateFormat).toHaveBeenCalledWith(expect.objectContaining({
      format: 'pem',
      containsPrivateKey: true,
      parameters: expect.objectContaining({
        configName: '设备兼容CRT单文件模板',
        outputPreset: 'pem_bundle',
        extension: 'crt',
        includeLeafCertificate: true,
        includeCertificateChain: true,
        includePrivateKey: true,
        runtimePlatform: 'other',
        systemPlatform: 'windows',
      }),
    }))
  })

  it('陌生运行时无需宿主选项即可使用平台通用模板', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建交付配置')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const systemSelect = wrapper.findAll('select').find((select) => select.find('option[value="windows"]').exists())
    expect(systemSelect).toBeTruthy()
    await systemSelect!.setValue('windows')
    await flushPromises()

    const runtimeInput = wrapper.find('[data-testid="runtime-platform-input"]')
    expect(runtimeInput.exists()).toBe(true)
    await runtimeInput.setValue('storage.nas')
    await flushPromises()

    const applyButton = wrapper.findAll('button').find((button) => button.text() === '套用内置模板')
    expect(applyButton).toBeTruthy()
    await applyButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('兼容部分设备要求')
    expect(wrapper.text()).toContain('编码选择')
    expect(wrapper.text()).toContain('包含私钥')
    expect((wrapper.find('[data-testid="runtime-platform-input"]').element as HTMLInputElement).value).toBe('storage.nas')
  })

  it('KEY 格式只保留私钥编码与私钥内容选择', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建交付配置')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const formatSelect = wrapper.findAll('select').find((select) => select.find('option[value="pem_key"]').exists())
    expect(formatSelect).toBeTruthy()
    await formatSelect!.setValue('pem_key')
    await flushPromises()

    expect(wrapper.text()).not.toContain('证书内容编码')
    expect(wrapper.text()).toContain('私钥编码')
    expect(wrapper.text()).toContain('包含私钥')
  })

  it('P7B 格式不显示私钥和密码，只保留链内容', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建交付配置')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const formatSelect = wrapper.findAll('select').find((select) => select.find('option[value="p7b"]').exists())
    expect(formatSelect).toBeTruthy()
    await formatSelect!.setValue('p7b')
    await flushPromises()

    expect(wrapper.text()).not.toContain('私钥编码')
    expect(wrapper.text()).not.toContain('passwordSecretRef')
  })

  it('可以编辑证书产物配置文件名称', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const editButton = wrapper.findAll('button').find((button) => button.text() === '编辑')
    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')
    await flushPromises()

    const nameInput = wrapper.findAll('input').find((input) => input.element.value === 'Windows-设备兼容单文件PEM模板')
    expect(nameInput).toBeTruthy()
    await setInputElementValue(nameInput!.element as HTMLInputElement, 'Windows-设备兼容单文件PEM模板-增强版')

    const saveButton = wrapper.findAll('button').find((button) => button.text() === '确认保存')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(certificateMocks.updateCertificateFormat).toHaveBeenCalledWith(expect.objectContaining({
      id: 'certfmt-1',
      parameters: expect.objectContaining({
        configName: 'Windows-设备兼容单文件PEM模板-增强版',
      }),
    }))
  })

  it('可以删除证书产物配置文件', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((button) => button.text() === '删除')
    expect(deleteButton).toBeTruthy()
    await deleteButton!.trigger('click')
    await flushPromises()

    expect(certificateMocks.deleteCertificateFormat).toHaveBeenCalledWith('certfmt-1')
  })

  it('没有 certificate.format.create 权限时不显示管理按钮', async () => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['binding.read'])

    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    expect(wrapper.text()).not.toContain('新建交付配置')
    expect(wrapper.text()).not.toContain('编辑')
    expect(wrapper.text()).not.toContain('删除')
  })
})
