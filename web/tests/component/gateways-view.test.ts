import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import GatewaysView from '@/views/gateways/GatewaysView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  listGateways: vi.fn(),
  probeGateway: vi.fn(),
  createAgentEnrollmentToken: vi.fn()
}))

vi.mock('@/api/modules/gateways.api', () => ({
  listGateways: apiMocks.listGateways,
  probeGateway: apiMocks.probeGateway
}))

vi.mock('@/api/modules/assets.api', () => ({
  createAgentEnrollmentToken: apiMocks.createAgentEnrollmentToken
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
        adapters: ['ssh', 'http'],
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
    apiMocks.createAgentEnrollmentToken.mockResolvedValue({
      data: {
        token: 'enroll_gateway.secret_once',
        tokenPreview: 'enroll_gatew...t_once',
        expiresAt: '2026-06-09T01:00:00.000Z',
        auditRef: 'req_token'
      },
      requestId: 'req_token',
      timestamp: '2026-06-09T00:00:00.000Z'
    })
  })

  it('点击登记网关会创建 Gateway Agent 注册令牌并展示一次性明文', async () => {
    const router = createRouterForGateway()
    const wrapper = mount(GatewaysView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '登记网关')?.trigger('click')
    await flushPromises()

    expect(apiMocks.createAgentEnrollmentToken).toHaveBeenCalledWith({
      allowedRoles: ['gateway'],
      allowedZones: ['default'],
      maxUses: 1,
      ttlSeconds: 3600
    })
    expect(wrapper.text()).toContain('Gateway Agent 注册令牌')
    expect(wrapper.text()).toContain('enroll_gateway.secret_once')
    expect(wrapper.text()).toContain('role=gateway')
    expect(wrapper.text()).toContain('req_token')
  })

  it('展示 Gateway 与无代理分组提示、Secret 引用边界和 Gateway 详情', async () => {
    const router = createRouterForGateway()
    const wrapper = mount(GatewaysView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Gateway Agent')
    expect(wrapper.text()).toContain('SSH 无代理')
    expect(wrapper.text()).toContain('WinRM 无代理')
    expect(wrapper.text()).toContain('CURL 无代理')
    expect(wrapper.text()).toContain('后端 Secret 引用')
    expect(wrapper.text()).toContain('dmz-gateway')
    expect(wrapper.text()).toContain('DMZ')
    expect(wrapper.text()).toContain('10.0.1.0/24')
    expect(wrapper.text()).toContain('app-zone')
    expect(wrapper.text()).toContain('ssh')
    expect(wrapper.text()).toContain('winrm')
    expect(wrapper.text()).toContain('curl')
    expect(wrapper.text()).toContain('dmz-ssh')
    expect(wrapper.text()).toContain('7%')
  })

  it('探测网关可达性走后端 API，不伪造 dryRun 语义', async () => {
    const router = createRouterForGateway()
    const wrapper = mount(GatewaysView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '探测网关可达性')?.trigger('click')
    await wrapper.find('[role="dialog"] input').setValue('PROBE')
    await wrapper.find('[role="dialog"] footer .gc-button--danger').trigger('click')
    await flushPromises()

    expect(apiMocks.probeGateway).toHaveBeenCalledWith({ gatewayId: 'gw-1', targetId: '10.0.1.0/24', protocol: 'ssh', port: 22 })
  })
})
