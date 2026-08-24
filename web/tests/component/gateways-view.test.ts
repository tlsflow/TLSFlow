import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import GatewaysView from '@/views/gateways/GatewaysView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  listGateways: vi.fn(),
  probeGateway: vi.fn(),
  createLinuxGoInstallSession: vi.fn(),
  createWindowsPowerShellInstallSession: vi.fn(),
  createGatewayEnableSession: vi.fn(),
  listAgents: vi.fn()
}))

vi.mock('@/api/modules/gateways.api', () => ({
  listGateways: apiMocks.listGateways,
  probeGateway: apiMocks.probeGateway
}))

vi.mock('@/api/modules/assets.api', () => ({
  createLinuxGoInstallSession: apiMocks.createLinuxGoInstallSession,
  createWindowsPowerShellInstallSession: apiMocks.createWindowsPowerShellInstallSession,
  createGatewayEnableSession: apiMocks.createGatewayEnableSession,
  listAgents: apiMocks.listAgents
}))

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_gateways',
    timestamp: '2026-06-09T00:00:00.000Z'
  }
}

function createRouterForGateway() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/assets', component: { template: '<div />' } },
      { path: '/executions', component: { template: '<div />' } }
    ]
  })
}

describe('GatewaysView', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['gateway.read', 'gateway.write'])
    apiMocks.listGateways.mockResolvedValue(okPage([
      {
        id: 'gw-1',
        name: 'dmz-gateway',
        status: 'ONLINE',
        risk: 'MEDIUM',
        zoneName: 'DMZ',
        adapters: ['probe.tcp', 'forward.agent_task', 'forward.direct_control'],
        reachableTargets: ['10.0.1.0/24', 'app-zone'],
        proxyProtocols: ['ssh', 'winrm', 'curl'],
        routeRules: [{ name: 'dmz-ssh', match: '10.0.1.0/24', target: 'ssh' }],
        taskStatistics: { total: 100, running: 3, failed: 7 },
        currentLoad: 3,
        successRate: '99.5%',
        updatedAt: '2026-06-09T08:00:00.000Z'
      }
    ]))
    apiMocks.probeGateway.mockResolvedValue({ data: {}, requestId: 'req_probe', timestamp: '2026-06-09T00:00:00.000Z' })
    apiMocks.createLinuxGoInstallSession.mockResolvedValue({
      data: {
        installCommand: 'install gateway now',
        bootstrapTokenPreview: 'gateway-code',
        zone: 'default',
        expiresAt: '2026-06-09T01:00:00.000Z',
      },
      requestId: 'req_install',
      timestamp: '2026-06-09T00:00:00.000Z'
    })
    apiMocks.listAgents.mockResolvedValue(okPage([{ id: 'agent-1', agentKey: 'linux-agent-1' }]))
    apiMocks.createGatewayEnableSession.mockResolvedValue({
      data: { enableCommand: 'enable gateway now', zone: 'default', serviceName: 'gcac-agent' },
      requestId: 'req_enable',
      timestamp: '2026-06-09T00:00:00.000Z'
    })
  })

  it('新增 Gateway Agent 会生成标准安装命令', async () => {
    const router = createRouterForGateway()
    const wrapper = mount(GatewaysView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '新增 Gateway Agent')?.trigger('click')
    await flushPromises()
    ;(Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === '生成安装命令') as HTMLButtonElement).click()
    await flushPromises()

    expect(apiMocks.createLinuxGoInstallSession).toHaveBeenCalledWith({
      zone: 'default',
      role: 'gateway',
      startAfterInstall: true
    })
    expect((document.body.querySelector('textarea') as HTMLTextAreaElement).value).toContain('install gateway now')
    expect(document.body.textContent).toContain('gateway-code')
  })

  it('Gateway 详情展示标准转发能力', async () => {
    const router = createRouterForGateway()
    const wrapper = mount(GatewaysView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '详情')?.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('连通性检查')
    expect(document.body.textContent).toContain('任务转发')
    expect(document.body.textContent).toContain('远程控制转发')
    expect(document.body.textContent).toContain('dmz-gateway')
    expect(document.body.textContent).toContain('DMZ')
  })

  it('探测网关可达性走后端 API，不伪造 dryRun 语义', async () => {
    const router = createRouterForGateway()
    const wrapper = mount(GatewaysView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '探测')?.trigger('click')
    const dialog = document.body.querySelector('.gc-confirm__mask[role="dialog"]')!
    const input = dialog.querySelector('input') as HTMLInputElement
    input.value = 'PROBE'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;(dialog.querySelector('.gc-button--danger') as HTMLButtonElement).click()
    await flushPromises()

    expect(apiMocks.probeGateway).toHaveBeenCalledWith({ gatewayId: 'gw-1', targetId: '10.0.1.0/24', protocol: 'probe.tcp', port: 22 })
  })
})
