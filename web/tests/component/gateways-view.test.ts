import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import GatewaysView from '@/views/gateways/GatewaysView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  listGateways: vi.fn(),
  probeGateway: vi.fn(),
  createAgentInstallMaterials: vi.fn(),
  listAgents: vi.fn()
}))

vi.mock('@/api/modules/gateways.api', () => ({
  listGateways: apiMocks.listGateways,
  probeGateway: apiMocks.probeGateway
}))

vi.mock('@/api/modules/assets.api', () => ({
  createAgentInstallMaterials: apiMocks.createAgentInstallMaterials,
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
    apiMocks.createAgentInstallMaterials.mockResolvedValue({
      data: {
        installationId: 'aginst_gateway_test',
        enrollmentToken: 'enrollment-gateway-once',
        materials: [{
          platform: 'linux_go',
          arch: 'amd64',
          artifactRef: 'artifact://gcac/agents/linux-go-full-agent/0.1.10/linux-amd64/gcac-agent',
          version: '0.1.10',
          digest: 'a'.repeat(64),
          signature: 'artifact://gcac/signatures/agents/linux-go-full-agent/0.1.10/linux-amd64.sig',
          signatureAlgorithm: 'Ed25519',
          signingKeyId: 'gcac-agent-release-v1',
        }],
        task: {
          type: 'agent.plan.execute',
          contractVersion: 'gcac.agent-security/v1',
          taskId: 'aginst_gateway_test',
          version: '0.1.10',
          artifactRefs: ['artifact://gcac/agents/linux-go-full-agent/0.1.10/linux-amd64/gcac-agent'],
          expiresAt: '2026-06-09T01:00:00.000Z',
          digest: 'b'.repeat(64),
          signature: 'artifact://gcac/signatures/agents/linux-go-full-agent/0.1.10/linux-amd64.sig',
          signatureAlgorithm: 'Ed25519',
          signingKeyId: 'gcac-agent-release-v1',
          input: { role: 'gateway', zone: 'default', agentKey: 'linux.gateway', serviceName: 'gcac-gateway-agent' },
        },
        zone: 'default',
        expiresAt: '2026-06-09T01:00:00.000Z',
      },
      requestId: 'req_install',
      timestamp: '2026-06-09T00:00:00.000Z'
    })
    apiMocks.listAgents.mockResolvedValue(okPage([{ id: 'agent-1', agentKey: 'linux-agent-1' }]))
  })

  it('新增 Gateway Agent 只请求固定安装材料', async () => {
    const router = createRouterForGateway()
    const wrapper = mount(GatewaysView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '新增 Gateway Agent')?.trigger('click')
    await flushPromises()
    ;(document.body.querySelector('.gateway-command-modal__primary') as HTMLButtonElement).click()
    await flushPromises()

    expect(apiMocks.createAgentInstallMaterials).toHaveBeenCalledWith({
      platform: 'linux_go',
      zone: 'default',
      role: 'gateway',
    })
    expect(document.body.textContent).toContain('artifact://gcac/agents/linux-go-full-agent/0.1.10/linux-amd64/gcac-agent')
    expect(document.body.textContent).toContain('enrollment-gateway-once')
    expect(document.body.textContent).not.toContain('installCommand')
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
