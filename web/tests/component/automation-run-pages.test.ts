import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AutomationRunsView from '@/views/automations/AutomationRunsView.vue'
import AutomationRunDetail from '@/views/automations/AutomationRunDetail.vue'

const apiMocks = vi.hoisted(() => ({
  listAutomationRuns: vi.fn(),
  getAutomationRun: vi.fn(),
  listAutomationRunTargets: vi.fn(),
  retryAutomationRun: vi.fn(),
  stopAutomationRun: vi.fn(),
  listTasks: vi.fn(),
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: { id: 'run-1' } }),
  useRouter: () => ({ push: apiMocks.push }),
}))

vi.mock('@/api/modules/automations.api', () => ({
  listAutomationRuns: apiMocks.listAutomationRuns,
  getAutomationRun: apiMocks.getAutomationRun,
  listAutomationRunTargets: apiMocks.listAutomationRunTargets,
  retryAutomationRun: apiMocks.retryAutomationRun,
  stopAutomationRun: apiMocks.stopAutomationRun,
}))

vi.mock('@/api/modules/tasks.api', () => ({
  listTasks: apiMocks.listTasks,
}))

describe('自动化运行页面', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.listAutomationRuns.mockResolvedValue([])
    apiMocks.listAutomationRunTargets.mockResolvedValue([])
    apiMocks.listTasks.mockResolvedValue({ data: { items: [] } })
  })

  it('运行列表覆盖加载、失败和空数据状态', async () => {
    apiMocks.listAutomationRuns.mockRejectedValueOnce(new Error('network failure'))
    const failed = mount(AutomationRunsView, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(failed.text()).toContain('自动化列表加载失败')
    expect(failed.text()).toContain('network failure')

    apiMocks.listAutomationRuns.mockResolvedValueOnce([])
    const empty = mount(AutomationRunsView, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(empty.text()).toContain('当前还没有运行记录。')
  })

  it('运行详情失败时提供恢复入口，成功时保留进度和目标空态', async () => {
    apiMocks.getAutomationRun.mockRejectedValueOnce(new Error('detail failure'))
    const failed = mount(AutomationRunDetail, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(failed.text()).toContain('自动化列表加载失败')
    expect(failed.text()).toContain('detail failure')

    apiMocks.getAutomationRun.mockResolvedValueOnce({
      id: 'run-1',
      automationNameSnapshot: '证书自动化',
      automationVersion: 2,
      status: 'succeeded',
      targetSummary: { total: 1, succeeded: 1 },
      triggerContext: null,
      actionResults: [],
    })
    const success = mount(AutomationRunDetail, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(success.text()).toContain('证书自动化')
    expect(success.text()).toContain('当前还没有运行记录。')
    expect(success.find('.run-detail__progress').exists()).toBe(true)
  })
})
