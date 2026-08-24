import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
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
  startDiscovery: vi.fn()
}))

const bindingMocks = vi.hoisted(() => ({
  listBindings: vi.fn(),
  createBinding: vi.fn(),
  detectBindingDrift: vi.fn(),
  persistBindingDriftResult: vi.fn(),
  listBindingUsages: vi.fn(),
  patchBindingStatus: vi.fn(),
  deleteBinding: vi.fn(),
  verifyBinding: vi.fn()
}))

vi.mock('@/api/modules/assets.api', () => assetMocks)
vi.mock('@/api/modules/bindings.api', () => bindingMocks)

import AssetsView from '@/views/assets/AssetsView.vue'
import BindingsView from '@/views/bindings/BindingsView.vue'

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_ok',
    timestamp: '2026-06-09T00:00:00.000Z'
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
      { path: '/capabilities', component: { template: '<div />' } },
      { path: '/certificates', component: { template: '<div />' } },
      { path: '/executions', component: { template: '<div />' } }
    ]
  })
}

function mountBusinessView(component: typeof AssetsView | typeof BindingsView) {
  return mount(component, {
    global: {
      plugins: [createBusinessRouter()],
      // 中文说明：Vue 内置 Teleport 在测试环境需要同时用大小写名称兜底，
      // 否则弹窗会被传送到 body，wrapper.find 查不到表单输入。
      stubs: { teleport: true, Teleport: true }
    }
  })
}

async function clickButtonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const vueButton = wrapper.findAll('button').find((button) => button.text() === text)
  if (vueButton) {
    await vueButton.trigger('click')
    await flushPromises()
    return
  }
  const domButton = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)
  if (!domButton) throw new Error(`找不到按钮：${text}`)
  domButton.click()
  await flushPromises()
}

async function setInputValue(selector: string, value: string) {
  const input = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!input) throw new Error(`找不到输入框：${selector}`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

describe('Spec028 资产和绑定操作链路', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['host.read', 'host.write', 'binding.read', 'binding.write'])
    assetMocks.listAssets.mockResolvedValue(okPage([
      {
        id: 'host-1',
        hostname: 'web-01.example.com',
        displayName: 'Web 01',
        osType: 'LINUX',
        osVersion: '22.04',
        arch: 'x86_64',
        zoneId: 'zone-a',
        compatibilityLevel: 'L3',
        managementMode: 'AGENT',
        status: 'ACTIVE',
        tags: ['prod']
      }
    ]))
    assetMocks.listServiceInstances.mockResolvedValue(okPage([
      {
        id: 'svc-1',
        hostId: 'host-1',
        providerType: 'NGINX',
        displayName: 'nginx-main',
        serviceName: 'nginx',
        versionText: '1.24.0',
        configPath: '/etc/nginx/nginx.conf',
        runtimeUser: 'nginx',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
        rawFacts: { ports: [443], manualOverrides: { reload: 'systemctl reload nginx' } }
      }
    ]))
    assetMocks.listCapabilities.mockResolvedValue(okPage([
      { id: 'cap-1', key: 'file.write', name: '文件写入', confidence: 'high', updatedAt: '2026-06-09T00:00:00.000Z', description: '可写证书文件' }
    ]))
    assetMocks.matchCapabilityRequirement.mockResolvedValue(okRecord({
      satisfiedCapabilities: [{ key: 'certificate.read', name: '读取证书', level: 'L2' }],
      missingCapabilities: [{ key: 'service.reload', name: '重载服务', level: 'L4', missingReason: '缺少 reload 权限', recommendation: '改走 Gateway' }]
    }, 'req_cap_match'))
    assetMocks.evaluateCapabilityCompatibility.mockResolvedValue(okRecord({
      compatibilityLevel: 'L4',
      degradeAdvice: '建议走 Gateway 或脚本包',
      manualDeclarations: [{ key: 'manual.reload', name: '人工声明 reload', level: 'L4', source: 'manual' }]
    }, 'req_cap_eval'))
    assetMocks.createHost.mockResolvedValue(okRecord({ id: 'host-new' }, 'req_host_create'))
    assetMocks.updateHost.mockResolvedValue(okRecord({ id: 'host-1' }, 'req_host_update'))
    assetMocks.deleteHost.mockResolvedValue(okRecord({ id: 'host-1' }, 'req_host_delete'))
    assetMocks.createServiceInstance.mockResolvedValue(okRecord({ id: 'svc-new' }, 'req_svc_create'))
    assetMocks.deleteServiceInstance.mockResolvedValue(okRecord({ id: 'svc-1' }, 'req_svc_delete'))
    assetMocks.previewDiscoveryMerge.mockResolvedValue(okRecord({
      actions: [{ kind: 'host', action: 'conflict', identityKey: 'host:web-01.example.com', reason: 'displayName 冲突' }],
      conflicts: [{ kind: 'host', identityKey: 'host:web-01.example.com', field: 'displayName', currentValue: 'Web 01', discoveredValue: '发现 Web 01', reason: '人工字段冲突' }]
    }, 'req_discovery'))
    bindingMocks.listBindings.mockResolvedValue(okPage([
      {
        id: 'binding-1',
        serviceInstanceId: 'svc-1',
        hostId: 'host-1',
        domainName: 'www.example.com',
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/certs/site.pem',
        keyPath: '/etc/nginx/private/site.key',
        desiredFingerprintSha256: 'a'.repeat(64),
        observedFingerprintSha256: 'b'.repeat(64),
        status: 'DRIFTED',
        verifyMethod: 'TLS_CONNECT'
      }
    ]))
    bindingMocks.createBinding.mockResolvedValue(okRecord({ id: 'binding-new' }, 'req_binding_create'))
    bindingMocks.detectBindingDrift.mockResolvedValue(okRecord({ state: 'mismatch' }, 'req_drift'))
    bindingMocks.persistBindingDriftResult.mockResolvedValue(okRecord({ state: 'mismatch' }, 'req_drift_save'))
    bindingMocks.listBindingUsages.mockResolvedValue(okPage([
      { id: 'usage-1', bindingId: 'binding-1', hostId: 'host-1', serviceInstanceId: 'svc-1', domainName: 'www.example.com', driftStatus: 'DRIFTED' }
    ]))
    bindingMocks.patchBindingStatus.mockResolvedValue(okRecord({ id: 'binding-1', status: 'MANAGED' }, 'req_binding_status'))
    bindingMocks.deleteBinding.mockResolvedValue(okRecord({ id: 'binding-1' }, 'req_binding_delete'))
    bindingMocks.verifyBinding.mockResolvedValue(okRecord({ state: 'unknown' }, 'req_verify'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('资产登记表单补齐新增字段并保留 Host 创建链路', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    await clickButtonByText(wrapper, '登记资产')
    await setInputValue('input[placeholder="web-01.example.com"]', 'web-02.example.com')
    await setInputValue('input[placeholder="zone-prod-a"]', 'zone-prod-a')
    await setInputValue('input[placeholder="ops-team-a"]', 'owner-ops')
    await setInputValue('input[placeholder="22.04"]', '24.04')
    await setInputValue('input[placeholder="x86_64 / arm64"]', 'arm64')
    await setInputValue('input[placeholder="ssh, agent, gateway"]', 'ssh, agent')
    await setInputValue('input[placeholder="prod, nginx, dmz"]', 'prod, dmz')
    await clickButtonByText(wrapper, '确认保存')

    expect(assetMocks.createHost).toHaveBeenCalledWith(expect.objectContaining({
      hostname: 'web-02.example.com',
      zoneId: 'zone-prod-a',
      ownerId: 'owner-ops',
      osVersion: '24.04',
      arch: 'arm64',
      managementChannels: ['ssh', 'agent'],
      tags: ['prod', 'dmz']
    }))
  })

  it('Host 编辑、软删除、ServiceInstance 和 Capability 入口可用', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Capability 最小矩阵')
    expect(wrapper.text()).toContain('文件写入')
    expect(wrapper.text()).toContain('缺少 reload 权限')
    expect(assetMocks.matchCapabilityRequirement).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'host-1' }))
    expect(assetMocks.evaluateCapabilityCompatibility).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'host-1' }))
    expect(wrapper.text()).toContain('nginx-main')

    await clickButtonByText(wrapper, '编辑 Host')
    await setInputValue('input[placeholder="zone-prod-a"]', 'zone-b')
    await clickButtonByText(wrapper, '确认保存')
    expect(assetMocks.updateHost).toHaveBeenCalledWith('host-1', expect.objectContaining({ zoneId: 'zone-b' }))

    await clickButtonByText(wrapper, '软删除 Host')
    expect(assetMocks.deleteHost).toHaveBeenCalledWith('host-1', expect.objectContaining({ reason: 'manual_soft_delete_from_console' }))

    await clickButtonByText(wrapper, '新增 ServiceInstance')
    await setInputValue('input[placeholder="nginx-main"]', 'tomcat-main')
    await setInputValue('input[placeholder="443, 8443"]', '8443, 9443')
    await setInputValue('textarea', '{"restart":"manual"}')
    await clickButtonByText(wrapper, '确认保存')
    expect(assetMocks.createServiceInstance).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'host-1',
      displayName: 'tomcat-main',
      rawFacts: { ports: [8443, 9443], manualOverrides: { restart: 'manual' } }
    }))

    await clickButtonByText(wrapper, '软删除服务实例')
    expect(assetMocks.deleteServiceInstance).toHaveBeenCalledWith('svc-1', expect.objectContaining({ reason: 'manual_soft_delete_from_console', hostId: 'host-1' }))
  })

  it('发现冲突入口展示当前值、发现值并支持 keep/use/custom', async () => {
    const wrapper = mountBusinessView(AssetsView)
    await flushPromises()

    await clickButtonByText(wrapper, '预览发现冲突')

    expect(assetMocks.previewDiscoveryMerge).toHaveBeenCalled()
    expect(wrapper.text()).toContain('当前值：Web 01')
    expect(wrapper.text()).toContain('发现值：发现 Web 01')
    const select = wrapper.find('.asset-ops__item--conflict select')
    await select.setValue('custom')
    await flushPromises()
    expect(wrapper.find('.asset-ops__item--conflict input').exists()).toBe(true)
  })

  it('新增绑定主按钮提交字段并展示漂移详情', async () => {
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('本地指纹')
    expect(wrapper.text()).toContain('目标指纹')
    await clickButtonByText(wrapper, '新增绑定')
    await setInputValue('input[placeholder="www.example.com"]', 'api.example.com')
    await setInputValue('input[placeholder="/etc/nginx/certs/site.pem"]', '/etc/nginx/api.pem')
    await setInputValue('input[placeholder="/etc/nginx/private/site.key"]', '/etc/nginx/api.key')
    await setInputValue('input[placeholder="systemctl reload nginx"]', 'systemctl reload nginx')
    await setInputValue('input[placeholder="64 位 sha256"]', 'a'.repeat(64))
    await setInputValue('input[placeholder="远端观测指纹"]', 'b'.repeat(64))
    await setInputValue('input[placeholder="本地配置指纹"]', 'c'.repeat(64))
    await setInputValue('input[placeholder="远端 TLS 实测指纹"]', 'd'.repeat(64))
    await setInputValue('.binding-form input', 'svc-1')
    await clickButtonByText(wrapper, '预览漂移')
    expect(document.body.textContent).toContain('mismatch')
    await clickButtonByText(wrapper, '保存验证结果')
    expect(bindingMocks.persistBindingDriftResult).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: 'binding-1',
      serviceInstanceId: 'svc-1'
    }))

    await clickButtonByText(wrapper, '确认新增')
    expect(bindingMocks.createBinding).toHaveBeenCalledWith(expect.objectContaining({
      serviceInstanceId: 'svc-1',
      domainName: 'api.example.com',
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/api.pem',
      keyPath: '/etc/nginx/api.key',
      reloadCommand: 'systemctl reload nginx',
      verifyMethod: 'TLS_CONNECT',
      desiredFingerprintSha256: 'a'.repeat(64),
      observedFingerprintSha256: 'b'.repeat(64),
      metadata: { localFingerprintSha256: 'c'.repeat(64), remoteFingerprintSha256: 'd'.repeat(64) }
    }))
    expect(bindingMocks.listBindingUsages).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ bindingId: 'binding-1' })
    }))
    expect(wrapper.text()).toContain('使用关系/影响范围')
    expect(wrapper.text()).toContain('www.example.com')
  })

  it('绑定创建失败时展示错误 requestId，且无权限隐藏主按钮', async () => {
    bindingMocks.createBinding.mockRejectedValueOnce(new ApiClientError('字段不合法', {
      errorCode: 'VALIDATION_FAILED',
      requestId: 'req_binding_bad',
      status: 400
    }))
    const wrapper = mountBusinessView(BindingsView)
    await flushPromises()
    await clickButtonByText(wrapper, '新增绑定')
    await setInputValue('.binding-form input', 'svc-bad')
    await clickButtonByText(wrapper, '确认新增')
    expect(document.body.textContent).toContain('req_binding_bad')
    expect(document.body.textContent).toContain('VALIDATION_FAILED')

    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['binding.read'])
    const readonlyWrapper = mountBusinessView(BindingsView)
    await flushPromises()
    expect(readonlyWrapper.text()).not.toContain('新增绑定')
  })
})
