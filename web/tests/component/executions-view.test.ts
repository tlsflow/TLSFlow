import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia } from 'pinia'
import { i18n } from '@/i18n'
import ExecutionsView from '@/views/executions/ExecutionsView.vue'

const apiMocks = vi.hoisted(() => ({
  listExecutions: vi.fn(),
  recoverExecution: vi.fn(),
  listDeploymentPlans: vi.fn(),
  listAssets: vi.fn(),
  reloadDetail: vi.fn(),
}))

const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, string> }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery.value }),
}))

vi.mock('@/api/modules/executions.api', () => ({
  listExecutions: apiMocks.listExecutions,
  recoverExecution: apiMocks.recoverExecution,
}))

vi.mock('@/api/modules/deployments.api', () => ({
  listDeploymentPlans: apiMocks.listDeploymentPlans,
}))

vi.mock('@/api/modules/assets.api', () => ({
  listAssets: apiMocks.listAssets,
}))

vi.mock('@/composables/useExecutionDetail', () => ({
  useExecutionDetail: () => ({
    loading: ref(false),
    error: ref(''),
    steps: ref([]),
    lines: ref([]),
    dryRunSummary: ref(null),
    hasUnknownResult: ref(false),
    reload: apiMocks.reloadDetail,
  }),
}))

describe('ExecutionsView', () => {
  beforeEach(() => {
    apiMocks.listExecutions.mockReset()
    apiMocks.recoverExecution.mockReset()
    apiMocks.listDeploymentPlans.mockReset()
    apiMocks.listAssets.mockReset()
    apiMocks.reloadDetail.mockReset()
    routeQuery.value = {}

    apiMocks.listDeploymentPlans.mockResolvedValue({
      data: {
        items: [
          {
            id: 'plan-1',
            name: '生产网关证书部署',
            targets: [{ executionTargetId: 'target-1' }],
          },
        ],
        page: 1,
        pageSize: 200,
        total: 1,
      },
      requestId: 'req-plans',
    })
    apiMocks.listAssets.mockResolvedValue({
      data: {
        items: [
          {
            id: 'asset-1',
            displayName: '生产 API 网关',
            targetBinding: { managedTargetId: 'target-1' },
          },
        ],
        page: 1,
        pageSize: 200,
        total: 1,
      },
      requestId: 'req-assets',
    })
  })

  function mountView() {
    return mount(ExecutionsView, {
      global: { plugins: [createPinia(), i18n] },
    })
  }

  it('列表展示计划、资产、结果和日志概要，并可点击打开详情', async () => {
    apiMocks.listExecutions.mockResolvedValue({
      data: {
        items: [
          {
            id: 'run-1',
            deploymentPlanId: 'plan-1',
            runNo: 3,
            type: 'apply',
            status: 'FAILED',
            errorCode: 'AGENT_OFFLINE',
            errorMessage: '目标 Agent 当前离线',
            startedAt: '2026-07-21T02:00:00.000Z',
            finishedAt: '2026-07-21T02:00:05.000Z',
          },
        ],
        page: 1,
        pageSize: 200,
        total: 1,
      },
      requestId: 'req-executions',
    })

    const wrapper = mount(ExecutionsView, {
      attachTo: document.body,
      global: { plugins: [createPinia(), i18n] },
    })

    await vi.waitFor(() => expect(wrapper.findAll('.execution-list__record')).toHaveLength(1))
    const record = wrapper.find('.execution-list__record')
    expect(record.text()).toContain('生产网关证书部署')
    expect(record.text()).toContain('生产 API 网关')
    expect(record.text()).toContain('失败')
    expect(record.text()).toContain('目标 Agent 当前离线')
    expect(wrapper.find('.business-page__metrics').exists()).toBe(false)

    await record.trigger('click')

    expect(apiMocks.reloadDetail).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('执行详情 run-1')
    expect(document.body.textContent).toContain('生产网关证书部署')
    wrapper.unmount()
  })

  it('执行记录超过二十条时只渲染当前页并支持翻页', async () => {
    apiMocks.listExecutions.mockResolvedValue({
      data: {
        items: Array.from({ length: 21 }, (_, index) => ({
          id: `run-${index + 1}`,
          deploymentPlanId: 'plan-1',
          runNo: index + 1,
          type: 'dry_run',
          status: 'SUCCESS',
          startedAt: new Date(Date.UTC(2026, 6, 21, 0, index)).toISOString(),
          finishedAt: new Date(Date.UTC(2026, 6, 21, 0, index, 5)).toISOString(),
        })),
        page: 1,
        pageSize: 200,
        total: 21,
      },
      requestId: 'req-executions',
    })

    const wrapper = mountView()

    await vi.waitFor(() => expect(wrapper.findAll('.execution-list__record')).toHaveLength(20))
    const nextButton = wrapper.findAll('.execution-list__pagination button')[1]
    await nextButton.trigger('click')
    expect(wrapper.findAll('.execution-list__record')).toHaveLength(1)
  })

  it('旧 id 查询参数仍能自动打开运行详情', async () => {
    routeQuery.value = { id: 'run-legacy' }
    apiMocks.listExecutions.mockResolvedValue({
      data: {
        items: [{ id: 'run-legacy', deploymentPlanId: 'plan-1', runNo: 1, type: 'apply', status: 'SUCCESS' }],
        page: 1,
        pageSize: 200,
        total: 1,
      },
      requestId: 'req-executions-legacy',
    })

    const wrapper = mountView()
    await vi.waitFor(() => expect(apiMocks.reloadDetail).toHaveBeenCalledOnce())
    expect(document.body.textContent).toContain('执行详情 run-legacy')
    wrapper.unmount()
  })
})
