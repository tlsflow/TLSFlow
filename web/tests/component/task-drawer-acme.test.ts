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
  RECENT_TASK_LIMIT: 10,
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

const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('button', { ...attrs, type: 'button' }, slots.default?.())
  },
})

const StatusTagStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => h('span', { ...attrs }, String(attrs.label ?? ''))
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

function activityWithRecentTasks(count: number) {
  return {
    activeTasks: [],
    recentTasks: Array.from({ length: count }, (_, index) => ({
      id: `task-recent-${index + 1}`,
      tenantId: 'tenant-1',
      taskType: 'WORKFLOW_RUN',
      definitionVersion: 1,
      category: 'SYSTEM',
      status: index % 3 === 0 ? 'SUCCEEDED' : index % 3 === 1 ? 'FAILED' : 'CANCELLED',
      triggerSource: 'test',
      payload: {},
      resourceSummary: { displayName: `测试任务 ${index + 1}` },
      progress: { status: 'completed' },
      createdAt: `2026-08-14T04:${String(index).padStart(2, '0')}:00.000Z`,
      finishedAt: `2026-08-14T04:${String(index).padStart(2, '0')}:20.000Z`,
    })),
    activeCount: 0,
    hasActive: false,
    connected: true,
  }
}

function emptyDisconnectedActivity() {
  return {
    activeTasks: [],
    recentTasks: [],
    activeCount: 0,
    hasActive: false,
    connected: false,
  }
}

function pluginRefreshTask() {
  return {
    id: 'task-plugin-refresh-1',
    tenantId: 'tenant-1',
    taskType: 'PLUGIN_REFERENCE_REFRESH',
    definitionVersion: 1,
    category: 'EXECUTION' as const,
    status: 'SUCCEEDED' as const,
    requestedBy: 'user_admin',
    triggerSource: 'plugin.catalog.refresh',
    payload: { scope: 'builtin-catalog' },
    createdAt: '2026-08-19T12:36:00.000Z',
    startedAt: '2026-08-19T12:36:01.000Z',
    finishedAt: '2026-08-19T12:36:06.000Z',
  }
}

function pluginRefreshDetail() {
  const task = pluginRefreshTask()
  return {
    task,
    attempts: [],
    childTasks: [],
    resourceRefs: [],
    auditEvents: [],
    events: [
      {
        id: 'event-created',
        eventType: 'CREATED',
        eventData: { category: 'EXECUTION', taskType: 'PLUGIN_REFERENCE_REFRESH' },
        createdAt: '2026-08-19T12:36:00.000Z',
      },
      {
        id: 'event-claimed',
        eventType: 'CLAIMED',
        eventData: { workerId: 'task-worker-2585', attemptNo: 1 },
        createdAt: '2026-08-19T12:36:01.000Z',
      },
      {
        id: 'event-succeeded',
        eventType: 'SUCCEEDED',
        eventData: {
          refreshedAt: '2026-08-19T12:36:06.000Z',
          versions: [
            { id: 'uplgv_nginx', pluginId: 'web-nginx', version: '1.5.0', status: 'ENABLED' },
            { id: 'uplgv_tomcat', pluginId: 'app-tomcat', version: '2.1.0', status: 'ENABLED' },
            { id: 'uplgv_npm', pluginId: 'device.nginx-proxy-manager', version: '0.1.0', status: 'PENDING_APPROVAL' },
          ],
          beforeVersions: [
            { id: 'uplgv_nginx-old', pluginId: 'web-nginx', version: '1.4.0', status: 'DISABLED' },
            { id: 'uplgv_tomcat', pluginId: 'app-tomcat', version: '2.1.0', status: 'ENABLED' },
          ],
          changes: [
            {
              pluginId: 'web-nginx',
              before: { id: 'uplgv_nginx-old', pluginId: 'web-nginx', version: '1.4.0', status: 'DISABLED' },
              after: { id: 'uplgv_nginx', pluginId: 'web-nginx', version: '1.5.0', status: 'ENABLED' },
              changeType: 'UPDATED',
            },
            {
              pluginId: 'app-tomcat',
              before: { id: 'uplgv_tomcat', pluginId: 'app-tomcat', version: '2.1.0', status: 'ENABLED' },
              after: { id: 'uplgv_tomcat', pluginId: 'app-tomcat', version: '2.1.0', status: 'ENABLED' },
              changeType: 'UNCHANGED',
            },
            {
              pluginId: 'device.nginx-proxy-manager',
              after: { id: 'uplgv_npm', pluginId: 'device.nginx-proxy-manager', version: '0.1.0', status: 'PENDING_APPROVAL' },
              changeType: 'ADDED',
            },
          ],
          projection: {
            attempted: 4,
            projected: 3,
            skipped: 0,
            failed: [{ agentId: 'agent-west-02', error: '连接超时' }],
          },
        },
        createdAt: '2026-08-19T12:36:06.000Z',
      },
    ],
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
          GcButton: ButtonStub,
          GcEmptyState: SlotStub,
          GcModal: SlotStub,
          GcProgressBar: SlotStub,
          GcStatusTag: StatusTagStub,
          GcTabs: SlotStub,
        },
      },
    })

    await flushAsyncWork()

    expect(acmeApiMocks.listAcmeRenewalJobs).toHaveBeenCalledTimes(1)
    expect(certificateApiMocks.getCertificateAssetDetail).toHaveBeenCalledWith('asset-1')
    expect(wrapper.get('.task-drawer__item-title').text()).toBe("ACME · *.ginease.cn（Let's Encrypt）证书续签")
    expect(wrapper.get('.task-drawer__item-summary').text()).toBe('续签成功')
    expect(wrapper.text()).not.toContain('成功 · completed')
    expect(taskApiMocks.listTasks).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('快速任务区最多展示最近十个已完成任务', async () => {
    const activity = activityWithRecentTasks(12)
    taskEventMocks.currentTaskActivity.mockReturnValue(activity)
    taskEventMocks.subscribeTaskActivity.mockImplementation((listener) => {
      listener(activity)
      return () => undefined
    })

    const wrapper = mount(TaskDrawer, {
      props: { open: true },
      global: {
        stubs: {
          GcButton: ButtonStub,
          GcEmptyState: SlotStub,
          GcModal: SlotStub,
          GcProgressBar: SlotStub,
          GcStatusTag: StatusTagStub,
          GcTabs: SlotStub,
        },
      },
    })

    await flushAsyncWork()

    const groups = wrapper.findAll('.task-drawer__group')
    expect(groups).toHaveLength(2)
    expect(groups[1]?.findAll('.task-drawer__item')).toHaveLength(10)
    wrapper.unmount()
  })

  it('实时连接不可用时通过任务接口恢复最近记录', async () => {
    const activity = emptyDisconnectedActivity()
    const task = pluginRefreshTask()
    taskEventMocks.currentTaskActivity.mockReturnValue(activity)
    taskEventMocks.subscribeTaskActivity.mockImplementation((listener) => {
      listener(activity)
      return () => undefined
    })
    taskApiMocks.listTasks.mockResolvedValue({ data: { items: [task], page: 1, pageSize: 100, total: 1 } })

    const wrapper = mount(TaskDrawer, {
      props: { open: true },
      global: {
        stubs: {
          GcButton: ButtonStub,
          GcEmptyState: SlotStub,
          GcModal: SlotStub,
          GcProgressBar: SlotStub,
          GcStatusTag: StatusTagStub,
          GcTabs: SlotStub,
        },
      },
    })

    await flushAsyncWork()

    expect(taskApiMocks.listTasks).toHaveBeenCalled()
    expect(wrapper.findAll('.task-drawer__item')).toHaveLength(1)
    expect(wrapper.findAll('.task-drawer__group-header')[1]?.text()).toContain('最近完成')
    wrapper.unmount()
  })

  it('将插件目录刷新结果呈现为业务摘要，并将原始事件收进折叠技术详情', async () => {
    const task = pluginRefreshTask()
    const activity = {
      activeTasks: [],
      recentTasks: [task],
      activeCount: 0,
      hasActive: false,
      connected: true,
    }
    taskEventMocks.currentTaskActivity.mockReturnValue(activity)
    taskEventMocks.subscribeTaskActivity.mockImplementation((listener) => {
      listener(activity)
      return () => undefined
    })
    taskApiMocks.getTask.mockResolvedValue({ data: pluginRefreshDetail() })

    const wrapper = mount(TaskDrawer, {
      props: { open: true },
      global: {
        stubs: {
          GcButton: ButtonStub,
          GcEmptyState: SlotStub,
          GcModal: SlotStub,
          GcProgressBar: SlotStub,
          GcStatusTag: StatusTagStub,
          GcTabs: SlotStub,
        },
      },
    })

    await flushAsyncWork()
    await wrapper.get('.task-drawer__item-open').trigger('click')
    await flushAsyncWork()

    expect(taskApiMocks.getTask).toHaveBeenCalledWith(task.id)
    expect(wrapper.find('.task-drawer__plugin-summary').exists()).toBe(true)
    expect(wrapper.text()).toContain('插件引用刷新 · 插件目录')
    expect(wrapper.text()).not.toContain('插件引用刷新 · 内置插件目录')
    expect(wrapper.text()).toContain('已完成刷新，共更新 3 个插件版本，并同步 3 个运行节点。')
    expect(wrapper.text()).toContain('目录版本')
    expect(wrapper.text()).toContain('web-nginx · 1.5.0')
    expect(wrapper.find('.task-drawer__plugin-changes').exists()).toBe(false)
    expect(wrapper.find('.task-drawer__plugin-version-transition').text()).toBe('1.4.0 → 1.5.0')
    expect(wrapper.find('.task-drawer__plugin-status-transition').text()).toBe('未启用 → 已启用')
    const pluginVersionRows = wrapper.findAll('.task-drawer__plugin-version')
    expect(pluginVersionRows[1]?.find('.task-drawer__plugin-version-transition').exists()).toBe(false)
    expect(pluginVersionRows[1]?.find('.task-drawer__plugin-status-transition').exists()).toBe(false)
    expect(pluginVersionRows[2]?.text()).toContain('device.nginx-proxy-manager · 0.1.0')
    expect(pluginVersionRows[2]?.text()).toContain('新增')
    expect(pluginVersionRows[2]?.text()).not.toContain('其他状态')
    expect(wrapper.text()).toContain('agent-west-02')
    expect(wrapper.find('.task-drawer__timeline').exists()).toBe(false)

    const technicalDetails = wrapper.get('.task-drawer__technical-details')
    expect((technicalDetails.element as HTMLDetailsElement).open).toBe(false)
    expect(technicalDetails.text()).toContain('PLUGIN_REFERENCE_REFRESH')
    wrapper.unmount()
  })
})
