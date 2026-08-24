import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskDrawer from '@/views/tasks/TaskDrawer.vue'

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }))
const taskApiMocks = vi.hoisted(() => ({
  forceCancelTask: vi.fn(),
  getTask: vi.fn(),
  listMonitoringProbes: vi.fn(),
  listTasks: vi.fn(),
}))
const taskEventMocks = vi.hoisted(() => ({
  currentTaskActivity: vi.fn(),
  isAutomationApprovalTask: vi.fn(() => false),
  isDeploymentApprovalTask: vi.fn(() => false),
  isDeploymentExecutionTask: vi.fn(() => false),
  isExecutionTask: vi.fn(() => false),
  isPendingApprovalTask: vi.fn(() => false),
  isQuickTask: vi.fn(() => true),
  subscribeTaskActivity: vi.fn(),
  subscribeTaskRealtime: vi.fn(),
}))
const acmeApiMocks = vi.hoisted(() => ({
  listAcmeProviders: vi.fn(),
  listAcmeRenewalJobs: vi.fn(),
  listAcmeRenewalPolicies: vi.fn(),
}))
const certificateApiMocks = vi.hoisted(() => ({ getCertificateAssetDetail: vi.fn() }))

vi.mock('vue-router', () => ({ useRouter: () => routerMocks }))
vi.mock('@/api/modules/tasks.api', () => taskApiMocks)
vi.mock('@/api/modules/audits.api', () => ({ decideApproval: vi.fn() }))
vi.mock('@/api/modules/automations.api', () => ({ getAutomationRun: vi.fn(), listAutomationRunTargets: vi.fn() }))
vi.mock('@/api/modules/certificates.api', () => certificateApiMocks)
vi.mock('@/api/modules/deployments.api', () => ({ listDeploymentPlans: vi.fn() }))
vi.mock('@/api/modules/internal-ca.api', () => ({ internalCaApi: acmeApiMocks }))
vi.mock('@/views/tasks/task-events', () => taskEventMocks)

const SlotStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

function activityWithCompletedAcmeTask() {
  return {
    activeTasks: [],
    recentTasks: [{
      id: 'task-acme-1',
      tenantId: 'tenant-1',
      taskType: 'ACME_CERTIFICATE_RENEWAL',
      definitionVersion: 1,
      category: 'SYSTEM',
      status: 'SUCCEEDED',
      triggerSource: 'acme.renewal.scheduler',
      payload: { renewalJobId: 'renewal-job-1' },
      progress: { status: 'completed' },
      createdAt: '2026-08-14T04:04:00.000Z',
      finishedAt: '2026-08-14T04:04:20.000Z',
    }],
    activeCount: 0,
    hasActive: false,
    connected: true,
  }
}

async function flushAsyncWork(): Promise<void> {
  await flushPromises()
  await nextTick()
  await flushPromises()
  await nextTick()
}

describe('TaskDrawer ACME 任务展示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const activity = activityWithCompletedAcmeTask()
    taskEventMocks.currentTaskActivity.mockReturnValue(activity)
    taskEventMocks.subscribeTaskActivity.mockImplementation((listener) => {
      listener(activity)
      return () => undefined
    })
    taskEventMocks.subscribeTaskRealtime.mockReturnValue(() => undefined)
    acmeApiMocks.listAcmeRenewalJobs.mockResolvedValue({
      data: { items: [{ id: 'renewal-job-1', policyId: 'policy-1' }] },
    })
    acmeApiMocks.listAcmeRenewalPolicies.mockResolvedValue({
      data: { items: [{ id: 'policy-1', certificateAssetId: 'asset-1', providerId: 'provider-1' }] },
    })
    acmeApiMocks.listAcmeProviders.mockResolvedValue({
      data: { items: [{ id: 'provider-1', name: "Let's Encrypt" }] },
    })
    certificateApiMocks.getCertificateAssetDetail.mockResolvedValue({
      data: { asset: { id: 'asset-1', primaryDomain: '*.ginease.cn' } },
    })
  })

  it('在快速任务区补全 ACME 证书和签发机构，并隐藏内部 completed 状态', async () => {
    const wrapper = mount(TaskDrawer, {
      props: { open: true },
      global: {
        stubs: {
          GcButton: SlotStub,
          GcEmptyState: SlotStub,
          GcModal: SlotStub,
          GcProgressBar: SlotStub,
          GcStatusTag: SlotStub,
          GcTabs: SlotStub,
        },
      },
    })

    await flushAsyncWork()

    expect(acmeApiMocks.listAcmeRenewalJobs).toHaveBeenCalledTimes(1)
    expect(certificateApiMocks.getCertificateAssetDetail).toHaveBeenCalledWith('asset-1')
    expect(wrapper.get('.task-drawer__item-title').text()).toBe("*.ginease.cn（Let's Encrypt）证书续签")
    expect(wrapper.get('.task-drawer__item-summary').text()).toBe('续签成功')
    expect(wrapper.text()).not.toContain('成功 · completed')
    expect(taskApiMocks.listTasks).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
