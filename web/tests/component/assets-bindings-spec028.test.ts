import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { usePermissionStore } from '@/stores/permission.store'

const assetMocks = vi.hoisted(() => ({
  createHost: vi.fn(),
  updateHost: vi.fn(),
  deleteHost: vi.fn(),
  deleteServiceInstance: vi.fn(),
  listAssets: vi.fn(),
  listCapabilities: vi.fn(),
  matchCapabilityRequirement: vi.fn(),
  evaluateCapabilityCompatibility: vi.fn(),
  listServiceInstances: vi.fn(),
  createServiceInstance: vi.fn(),
  updateServiceInstance: vi.fn(),
  previewDiscoveryMerge: vi.fn(),
  startDiscovery: vi.fn(),
  createServiceAsset: vi.fn(),
  updateServiceAsset: vi.fn(),
  getAssetDetail: vi.fn(),
  listAgents: vi.fn(),
  getAgentDetail: vi.fn(),
  listSiteAssets: vi.fn(),
  createSiteAsset: vi.fn(),
  listManagedTargets: vi.fn(),
  createManagedTarget: vi.fn(),
  listManagedTargetSnapshots: vi.fn(),
}))

const certificateMocks = vi.hoisted(() => ({
  listCertificateFormats: vi.fn(),
  createCertificateFormat: vi.fn(),
  updateCertificateFormat: vi.fn(),
  deleteCertificateFormat: vi.fn(),
}))

const workflowMocks = vi.hoisted(() => ({
  listWorkflowTemplates: vi.fn(),
  listWorkflowTemplateVersions: vi.fn(),
}))

const gatewayMocks = vi.hoisted(() => ({
  listGateways: vi.fn(),
}))

const securityMocks = vi.hoisted(() => ({
  listSecrets: vi.fn(),
}))

vi.mock('@/api/modules/assets.api', () => assetMocks)
vi.mock('@/api/modules/certificates.api', () => certificateMocks)
vi.mock('@/api/modules/workflow-templates.api', () => workflowMocks)
vi.mock('@/api/modules/gateways.api', () => gatewayMocks)
vi.mock('@/api/modules/security.api', () => securityMocks)

import AssetsView from '@/views/assets/AssetsView.vue'
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
      { path: '/assets', component: { template: '<div />' } },
      { path: '/bindings', component: { template: '<div />' } },
      { path: '/certificates', component: { template: '<div />' } },
    ],
  })
}

function mountBusinessView(component: typeof AssetsView | typeof BindingsView) {
  return mount(component, {
    global: {
      plugins: [createBusinessRouter()],
      stubs: { teleport: true, Teleport: true },
    },
  })
}

async function setInputElementValue(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

describe('资产与证书产物视图', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    usePermissionStore().setPermissions([
      'service_asset.read',
      'service_asset.manage',
      'binding.read',
      'certificate.format.create',
    ])

    assetMocks.listAssets.mockResolvedValue(okPage([
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
    assetMocks.listServiceInstances.mockResolvedValue(okPage([
      { id: 'svc-1', displayName: 'nginx-main', providerType: 'NGINX', hostId: 'host-1', rawFacts: { ports: [443] } },
    ]))
    assetMocks.listAgents.mockResolvedValue(okPage([{ id: 'agent-1', displayName: 'agent-1' }]))
    assetMocks.listSiteAssets.mockResolvedValue(okPage([]))
    assetMocks.listManagedTargets.mockResolvedValue(okPage([]))
    assetMocks.listManagedTargetSnapshots.mockResolvedValue(okPage([]))
    assetMocks.getAgentDetail.mockResolvedValue(okRecord({ id: 'agent-1', capabilitySnapshot: { capabilities: [] } }))
    assetMocks.getAssetDetail.mockResolvedValue(okRecord({ id: 'asset-1' }))
    assetMocks.listCapabilities.mockResolvedValue(okPage([]))
    assetMocks.matchCapabilityRequirement.mockResolvedValue(okRecord({ satisfiedCapabilities: [], missingCapabilities: [] }))
    assetMocks.evaluateCapabilityCompatibility.mockResolvedValue(okRecord({ compatibilityLevel: 'L2', manualDeclarations: [] }))
    assetMocks.createServiceAsset.mockResolvedValue(okRecord({ id: 'asset-2' }, 'req_asset_create'))
    assetMocks.updateServiceAsset.mockResolvedValue(okRecord({ id: 'asset-1' }, 'req_asset_update'))
    assetMocks.createSiteAsset.mockResolvedValue(okRecord({ id: 'site-1' }, 'req_site_create'))
    assetMocks.createManagedTarget.mockResolvedValue(okRecord({ id: 'target-1' }, 'req_target_create'))

    workflowMocks.listWorkflowTemplates.mockResolvedValue(okPage([
      { id: 'workflow-1', name: 'Apache 证书替换' },
    ]))
    workflowMocks.listWorkflowTemplateVersions.mockResolvedValue({
      data: {
        items: [{
          id: 'workflow-version-1',
          version: 'v1',
          status: 'published',
          templateId: 'workflow-1',
          content: {
            variables: {
              deviceHost: { type: 'string', required: true, description: '目标主机' },
              verifyUrl: { type: 'string', required: true, description: '验证 URL' },
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
    certificateMocks.createCertificateFormat.mockResolvedValue(okRecord({ id: 'certfmt-2' }, 'req_format_create'))
    certificateMocks.updateCertificateFormat.mockResolvedValue(okRecord({ id: 'certfmt-1' }, 'req_format_update'))
    certificateMocks.deleteCertificateFormat.mockResolvedValue(okRecord({ id: 'certfmt-1' }, 'req_format_delete'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('资产页仍然可以正常加载基础列表', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    expect(assetMocks.listAssets).toHaveBeenCalled()
    expect(wrapper.text()).toContain('www.example.com')
  })

  it('asset list renders site and agent display names instead of ids', async () => {
    assetMocks.listAssets.mockResolvedValue(okPage([
      {
        id: 'asset-name-1',
        address: 'named.example.com',
        displayName: 'named.example.com',
        port: 443,
        protocol: 'HTTPS',
        platform: 'LINUX',
        agentId: 'agt_001',
        targetBinding: {
          frameworkType: 'NGINX',
          siteAssetId: 'sit_001',
        },
        status: 'ACTIVE',
      },
    ]))
    assetMocks.listAgents.mockResolvedValue(okPage([
      { id: 'agt_001', displayName: 'prod-agent' },
    ]))
    assetMocks.listSiteAssets.mockResolvedValue(okPage([
      { id: 'sit_001', siteName: 'prod-site' },
    ]))

    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    expect(wrapper.text()).toContain('prod-site')
    expect(wrapper.text()).toContain('prod-agent')
    expect(wrapper.text()).not.toContain('sit_001')
    expect(wrapper.text()).not.toContain('agt_001')
  })

  it('应用资产可以按工作流模式创建并保存部署策略', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '添加资产')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const workflowModeButton = wrapper.findAll('button').find((button) => button.text().includes('工作流模式'))
    expect(workflowModeButton).toBeTruthy()
    await workflowModeButton!.trigger('click')
    await flushPromises()

    const addressInput = wrapper.findAll('input').find((input) => input.attributes('placeholder') === 'app.example.com')
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

    expect(wrapper.text()).toContain('运行变量')
    expect(wrapper.text()).not.toContain('运行变量 JSON')
    expect(wrapper.findAll('input').some((input) => input.element.value === 'deviceHost')).toBe(true)
    expect(wrapper.findAll('input').some((input) => input.element.value === 'app.example.com')).toBe(true)

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
      deploymentStrategy: {
        type: 'WORKFLOW',
        workflow: {
          workflowId: 'workflow-1',
          workflowVersionId: 'workflow-version-1',
          runner: 'CONTROL_PLANE',
          gatewayId: undefined,
          variableBindings: {
            deviceHost: 'app.example.com',
            verifyUrl: 'https://app.example.com:443',
          },
        },
      },
    }))
    expect(assetMocks.createServiceAsset.mock.calls[0][0]).not.toHaveProperty('targetBinding')
    expect(assetMocks.createServiceAsset.mock.calls[0][0]).not.toHaveProperty('agentId')
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
    expect(wrapper.text()).toContain('公钥 · 证书链 · 私钥')
  })

  it('可以创建设备兼容单文件 PEM Bundle 并选择公钥、证书链、私钥', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建配置文件')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const systemSelect = wrapper.findAll('select').find((select) => select.find('option[value="windows"]').exists())
    expect(systemSelect).toBeTruthy()
    await systemSelect!.setValue('windows')
    await flushPromises()

    const runtimeSelect = wrapper.findAll('select').find((select) => select.find('option[value="other"]').exists())
    expect(runtimeSelect).toBeTruthy()
    await runtimeSelect!.setValue('other')
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

  it('IIS PFX 模板隐藏编码，只保留容器包含项与密码', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建配置文件')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const systemSelect = wrapper.findAll('select').find((select) => select.find('option[value="windows"]').exists())
    expect(systemSelect).toBeTruthy()
    await systemSelect!.setValue('windows')
    await flushPromises()

    const runtimeSelect = wrapper.findAll('select').find((select) => select.find('option[value="iis"]').exists())
    expect(runtimeSelect).toBeTruthy()
    await runtimeSelect!.setValue('iis')
    await flushPromises()

    const applyButton = wrapper.findAll('button').find((button) => button.text() === '套用内置模板')
    expect(applyButton).toBeTruthy()
    await applyButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('IIS 使用 PKCS#12/PFX 容器最常见')
    expect(wrapper.text()).not.toContain('编码选择')
    expect(wrapper.text()).toContain('包含私钥')
    expect(wrapper.text()).toContain('导出密码')
  })

  it('KEY 格式只保留私钥编码与私钥内容选择', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建配置文件')
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

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建配置文件')
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

    expect(wrapper.text()).not.toContain('新建配置文件')
    expect(wrapper.text()).not.toContain('编辑')
    expect(wrapper.text()).not.toContain('删除')
  })
})
