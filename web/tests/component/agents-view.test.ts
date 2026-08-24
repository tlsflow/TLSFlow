import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AgentsView from '@/views/agents/AgentsView.vue'
import { usePermissionStore } from '@/stores/permission.store'
import { ApiClientError } from '@/api/client'

const apiMocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  getAgentDetail: vi.fn(),
  listAgentCapabilities: vi.fn(),
  listAgentTaskQueue: vi.fn(),
  checkAgentUpgrade: vi.fn(),
  createAgentEnrollmentToken: vi.fn(),
  disableAgent: vi.fn()
}))

vi.mock('@/api/modules/assets.api', () => ({
  listAgents: apiMocks.listAgents,
  getAgentDetail: apiMocks.getAgentDetail,
  listAgentCapabilities: apiMocks.listAgentCapabilities,
  listAgentTaskQueue: apiMocks.listAgentTaskQueue,
  checkAgentUpgrade: apiMocks.checkAgentUpgrade,
  createAgentEnrollmentToken: apiMocks.createAgentEnrollmentToken,
  disableAgent: apiMocks.disableAgent
}))

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_agents',
    timestamp: '2026-06-09T00:00:00.000Z'
  }
}

describe('AgentsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['agent.read', 'agent.write'])
    apiMocks.listAgents.mockResolvedValue(okPage([
      {
        id: 'agt-1',
        agentKey: 'agent-prod-1',
        descriptor: { hostname: 'prod-1', version: '1.2.3', osType: 'linux', arch: 'amd64' },
        status: 'ONLINE',
        role: 'full_agent',
        taskSummary: { running: 1, queued: 2, succeeded: 8, failed: 1 },
        recentError: '上一轮部署 reload nginx 失败'
      }
    ]))
    apiMocks.getAgentDetail.mockResolvedValue({
      data: {
        id: 'agt-1',
        descriptor: { hostname: 'prod-1', version: '1.2.4', osType: 'linux', arch: 'amd64' },
        status: 'ONLINE',
        taskSummary: { running: 1, queued: 2, succeeded: 8, failed: 1 },
        recentError: '上一轮部署 reload nginx 失败'
      },
      requestId: 'req_detail',
      timestamp: '2026-06-09T00:00:00.000Z'
    })
    apiMocks.listAgentCapabilities.mockResolvedValue(okPage([
      { capabilityKey: 'cert.deploy.nginx', value: 'supported', confidence: 0.96, evidence: { source: 'agent-probe' }, reportedAt: '2026-06-09T00:00:00.000Z' }
    ]))
    apiMocks.listAgentTaskQueue.mockResolvedValue(okPage([
      { id: 'task-1', status: 'queued', executionRunId: 'run-1', updatedAt: '2026-06-09T00:00:00.000Z' }
    ]))
    apiMocks.checkAgentUpgrade.mockResolvedValue({
      data: { status: 'planned', targetVersion: '1.3.0', reason: '发现可用升级版本' },
      requestId: 'req_upgrade',
      timestamp: '2026-06-09T00:00:00.000Z'
    })
    apiMocks.createAgentEnrollmentToken.mockResolvedValue({ data: { token: 'secret' }, requestId: 'req_token', timestamp: '2026-06-09T00:00:00.000Z' })
    apiMocks.disableAgent.mockResolvedValue({ data: {}, requestId: 'req_disable', timestamp: '2026-06-09T00:00:00.000Z' })
  })

  it('展示执行能力分组和 Agent 详情：版本、OS、架构、连接状态、Capability、队列、错误、升级建议', async () => {
    const wrapper = mount(AgentsView)
    await flushPromises()
    await flushPromises()

    expect(apiMocks.getAgentDetail).toHaveBeenCalledWith('agt-1')
    expect(apiMocks.listAgentCapabilities).toHaveBeenCalledWith('agt-1')
    expect(apiMocks.listAgentTaskQueue).toHaveBeenCalledWith('agt-1')
    expect(apiMocks.checkAgentUpgrade).toHaveBeenCalledWith('agt-1')

    expect(wrapper.text()).toContain('Full Agent')
    expect(wrapper.text()).toContain('Legacy Agent')
    expect(wrapper.text()).toContain('Gateway Agent')
    expect(wrapper.text()).toContain('SSH')
    expect(wrapper.text()).toContain('WinRM')
    expect(wrapper.text()).toContain('CURL')
    expect(wrapper.text()).toContain('1.2.4')
    expect(wrapper.text()).toContain('linux')
    expect(wrapper.text()).toContain('amd64')
    expect(wrapper.text()).toContain('ONLINE')
    expect(wrapper.text()).toContain('cert.deploy.nginx')
    expect(wrapper.text()).toContain('96%')
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.text()).toContain('task-1')
    expect(wrapper.text()).toContain('上一轮部署 reload nginx 失败')
    expect(wrapper.text()).toContain('planned · 目标 1.3.0 · 发现可用升级版本')
  })

  it('详情接口缺失时不伪造成功，显示降级提示并保留列表字段', async () => {
    apiMocks.getAgentDetail.mockRejectedValue(new ApiClientError('not found', { errorCode: 'HTTP_404', requestId: 'req_404', status: 404 }))
    apiMocks.listAgentCapabilities.mockRejectedValue(new ApiClientError('not found', { errorCode: 'HTTP_404', requestId: 'req_404_cap', status: 404 }))
    apiMocks.listAgentTaskQueue.mockRejectedValue(new ApiClientError('not found', { errorCode: 'HTTP_404', requestId: 'req_404_task', status: 404 }))
    apiMocks.checkAgentUpgrade.mockRejectedValue(new ApiClientError('not found', { errorCode: 'HTTP_404', requestId: 'req_404_up', status: 404 }))

    const wrapper = mount(AgentsView)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('接口暂不可用')
    expect(wrapper.text()).toContain('没有伪造成功数据')
    expect(wrapper.text()).toContain('1.2.3')
    expect(wrapper.text()).toContain('暂无 Capability 数据')
    expect(wrapper.text()).toContain('暂无升级建议')
  })
})
