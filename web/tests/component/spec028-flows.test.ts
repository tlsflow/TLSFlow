import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { ApiClientError } from '@/api/client'
import { usePermissionStore } from '@/stores/permission.store'
import GcExecutionLogViewer from '@/design-system/components/GcExecutionLogViewer.vue'

const deploymentMocks = vi.hoisted(() => ({
  listCertificates: vi.fn(),
  listBindings: vi.fn(),
  createDeploymentPlan: vi.fn(),
  dryRunDeploymentPlan: vi.fn(),
  submitDeploymentPlan: vi.fn(),
  executeDeploymentPlan: vi.fn(),
  cancelDeploymentPlan: vi.fn(),
  retryExecution: vi.fn(),
  rollbackExecution: vi.fn(),
  listDeploymentPlans: vi.fn()
}))

const monitorMocks = vi.hoisted(() => ({
  listMonitors: vi.fn(),
  scanMonitorRisks: vi.fn(),
  listDashboardRisks: vi.fn()
}))

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificates: deploymentMocks.listCertificates
}))

vi.mock('@/api/modules/bindings.api', () => ({
  listBindings: deploymentMocks.listBindings
}))

vi.mock('@/views/deployments/deployment-plan.config', () => ({
  deploymentPlansPageConfig: {
    title: '部署计划',
    description: '测试',
    readPermission: 'deployment.plan.read',
    primaryPermission: 'deployment.plan.write',
    primaryActionLabel: '创建部署计划',
    moduleName: 'deployment-plans',
    resourceName: '部署计划',
    defaultStatus: 'PENDING_APPROVAL',
    defaultRisk: 'HIGH',
    columns: [
      { key: 'name', title: '名称', candidates: ['name'] },
      { key: 'status', title: '状态', candidates: ['status'] },
      { key: 'risk', title: '风险', candidates: ['risk'] }
    ],
    metrics: [{ title: '总数', description: 'desc', status: 'READY', risk: 'MEDIUM' }],
    emptyTitle: '暂无部署计划',
    emptyDescription: '空',
    load: deploymentMocks.listDeploymentPlans,
    actions: []
  },
  deploymentPlanActions: {
    createDeploymentPlan: deploymentMocks.createDeploymentPlan,
    dryRunDeploymentPlan: deploymentMocks.dryRunDeploymentPlan,
    submitDeploymentPlan: deploymentMocks.submitDeploymentPlan,
    executeDeploymentPlan: deploymentMocks.executeDeploymentPlan,
    cancelDeploymentPlan: deploymentMocks.cancelDeploymentPlan,
    retryExecution: deploymentMocks.retryExecution,
    rollbackExecution: deploymentMocks.rollbackExecution
  },
  deploymentPlanUiActions: [
    {
      key: 'execute',
      label: '执行部署',
      permission: 'deployment.plan.execute',
      danger: true,
      confirmText: 'EXECUTE',
      riskText: '执行真实计划',
      visibleWhen: ['APPROVED'],
      run: (row: any) => deploymentMocks.executeDeploymentPlan(String(row.raw.id ?? row.id)),
      disabledReason: (row: any) => row.raw.approvalId ? '' : '缺少 approvalId，不能执行'
    },
    {
      key: 'retry',
      label: '重试执行',
      permission: 'deployment.plan.execute',
      danger: true,
      confirmText: 'RETRY',
      riskText: '重试真实执行批次',
      visibleWhen: ['FAILED'],
      run: (row: any) => deploymentMocks.retryExecution(String(row.raw.runs?.[0]?.id), { planId: String(row.raw.id) }),
      disabledReason: (row: any) => row.raw.runs?.[0]?.id ? '' : '缺少 runId，不能重试'
    },
    {
      key: 'rollback',
      label: '回滚执行',
      permission: 'execution.rollback',
      danger: true,
      confirmText: 'ROLLBACK',
      riskText: '回滚真实执行批次',
      visibleWhen: ['FAILED', 'SUCCEEDED'],
      run: (row: any) => deploymentMocks.rollbackExecution(String(row.raw.runs?.[0]?.id), { planId: String(row.raw.id) }),
      disabledReason: (row: any) => row.raw.runs?.[0]?.id ? '' : '缺少 runId，不能回滚'
    }
  ],
  latestRunId: (row: any) => String(row.raw.runs?.[0]?.id ?? ''),
  requirePlanId: (row: any) => String(row.raw.id ?? row.id)
}))

vi.mock('@/api/modules/monitors.api', () => ({
  listMonitors: monitorMocks.listMonitors,
  scanMonitorRisks: monitorMocks.scanMonitorRisks
}))

vi.mock('@/api/modules/dashboard.api', () => ({
  listDashboardRisks: monitorMocks.listDashboardRisks
}))

import DeploymentPlansView from '@/views/deployments/DeploymentPlansView.vue'
import MonitorsView from '@/views/monitoring/MonitorsView.vue'
import WorkflowTemplatesView from '@/views/workflows/WorkflowTemplatesView.vue'

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_ok',
    timestamp: '2026-06-08T00:00:00.000Z'
  }
}


function clickBodyButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) as HTMLButtonElement | undefined
  expect(button).toBeTruthy()
  button!.click()
}

function bodyText() {
  return document.body.textContent ?? ''
}

function bodyFormControls<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector: string) {
  const controls = [...document.body.querySelectorAll<T>(selector)]
  expect(controls.length).toBeGreaterThan(0)
  return controls
}

function createTestRouter(path = '/deployment-plans') {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployment-plans', component: DeploymentPlansView },
      { path: '/certificates', component: { template: '<div>certificates</div>' } },
      { path: '/bindings', component: { template: '<div>bindings</div>' } },
      { path: '/executions', component: { template: '<div>executions</div>' } },
      { path: '/monitors', component: MonitorsView }
    ]
  })
}

describe('spec028 前端闭环', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['deployment.plan.write', 'deployment.plan.read', 'deployment.plan.execute', 'execution.rollback', 'monitor.read', 'monitor.write'])
    deploymentMocks.listCertificates.mockResolvedValue(okPage([
      {
        id: 'cert-1',
        primaryDomain: 'a.example.com',
        hasPrivateKey: true,
        capabilities: [{ key: 'deploy.api', state: 'satisfied', level: 'L2', detail: 'ready' }]
      }
    ]))
    deploymentMocks.listBindings.mockResolvedValue(okPage([
      { id: 'binding-1', domainName: 'a.example.com', certificateId: 'cert-1', capabilities: [{ key: 'gateway.push', state: 'manualRisk', level: 'L4' }] }
    ]))
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([]))
    deploymentMocks.createDeploymentPlan.mockResolvedValue({ data: { id: 'plan-1' }, requestId: 'req_create', timestamp: '2026-06-08T00:00:00.000Z' })
    deploymentMocks.dryRunDeploymentPlan.mockResolvedValue({ data: { id: 'dry-run' }, requestId: 'req_dry', timestamp: '2026-06-08T00:00:00.000Z' })
    deploymentMocks.submitDeploymentPlan.mockResolvedValue({ data: { id: 'plan-1' }, requestId: 'req_submit', timestamp: '2026-06-08T00:00:00.000Z' })
    deploymentMocks.executeDeploymentPlan.mockResolvedValue({ data: { id: 'run-1' }, requestId: 'req_execute', timestamp: '2026-06-08T00:00:00.000Z' })
    deploymentMocks.cancelDeploymentPlan.mockResolvedValue({ data: { id: 'plan-1' }, requestId: 'req_cancel', timestamp: '2026-06-08T00:00:00.000Z' })
    deploymentMocks.retryExecution.mockResolvedValue({ data: { id: 'run-1' }, requestId: 'req_retry', timestamp: '2026-06-08T00:00:00.000Z' })
    deploymentMocks.rollbackExecution.mockResolvedValue({ data: { id: 'run-1' }, requestId: 'req_rollback', timestamp: '2026-06-08T00:00:00.000Z' })
    monitorMocks.listMonitors.mockResolvedValue(okPage([]))
    monitorMocks.listDashboardRisks.mockResolvedValue(okPage([
      { id: 'risk-1', title: '证书即将过期', risk: 'HIGH', status: 'READY', certificateId: 'cert-1' }
    ]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('部署向导完成选择、dry-run 与提交闭环', async () => {
    const router = createTestRouter()
    router.push('/deployment-plans?certificateId=cert-1')
    await router.isReady()

    const wrapper = mount(DeploymentPlansView, {
      attachTo: document.body,
      global: {
        plugins: [router]
      }
    })
    await flushPromises()
    ;(wrapper.vm as any).openWizard()
    await flushPromises()

    expect(document.body.textContent ?? '').toContain('部署向导真实闭环')
    expect(document.body.textContent ?? '').toContain('Capability 兼容性')
    const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
    clickBodyButton('Dry-run')
    await flushPromises()
    expect(deploymentMocks.createDeploymentPlan).toHaveBeenCalledWith(expect.objectContaining({
      certificateId: 'cert-1',
      certificateVersionId: 'cert-1',
      targets: [{ certificateBindingId: 'binding-1' }]
    }))
    expect(deploymentMocks.dryRunDeploymentPlan).toHaveBeenCalledWith({ planId: 'plan-1' })
    expect(document.body.textContent ?? '').toContain('最近 dry-run：req_dry')

    clickBodyButton('提交计划')
    await flushPromises()
    expect(deploymentMocks.createDeploymentPlan).toHaveBeenCalledTimes(1)
    expect(deploymentMocks.submitDeploymentPlan).toHaveBeenCalledWith('plan-1')
    expect(document.body.textContent ?? '').toContain('最近提交：req_submit')
  })


  it('部署计划详情展示 targets、runs、steps、approvalId、snapshotHash 和失败原因，并按状态显示操作', async () => {
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([
      {
        id: 'plan-approved',
        name: '生产证书部署',
        status: 'APPROVED',
        risk: 'HIGH',
        approvalId: 'approval-1',
        snapshotHash: 'sha256:abc',
        targets: [{ certificateBindingId: 'binding-1', status: 'READY' }],
        runs: [{ id: 'run-1', status: 'FAILED', failureReason: 'gateway timeout' }],
        steps: [{ id: 'step-1', name: '推送证书', status: 'PENDING' }],
        failureReason: 'gateway timeout'
      }
    ]))
    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    const wrapper = mount(DeploymentPlansView, {
      global: { plugins: [router], stubs: { teleport: true, Teleport: true } }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('真实状态闭环')
    expect(wrapper.text()).toContain('approval-1')
    expect(wrapper.text()).toContain('sha256:abc')
    expect(wrapper.text()).toContain('gateway timeout')
    expect(wrapper.text()).toContain('Targets 目标')
    expect(wrapper.text()).toContain('Runs 执行批次')
    expect(wrapper.text()).toContain('Steps 步骤')
    expect(wrapper.text()).toContain('执行部署')
    expect(wrapper.text()).not.toContain('重试执行')
  })

  it('失败部署计划显示 retry/rollback，并使用真实 runId，不传空 planId 或假 dryRun', async () => {
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([
      {
        id: 'plan-failed',
        name: '失败计划',
        status: 'FAILED',
        risk: 'HIGH',
        runs: [{ id: 'run-failed', status: 'FAILED', failureReason: 'agent offline' }],
        steps: [{ id: 'step-failed', status: 'FAILED' }],
        failureReason: 'agent offline'
      }
    ]))
    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    const wrapper = mount(DeploymentPlansView, {
      global: { plugins: [router], stubs: { teleport: true, Teleport: true } }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('重试执行')
    expect(wrapper.text()).toContain('回滚执行')
    expect(wrapper.text()).toContain('run-failed')
    expect(wrapper.text()).toContain('agent offline')
  })

  it('风险卡片跳转到证书筛选上下文', async () => {
    const router = createTestRouter('/monitors')
    router.push('/monitors')
    await router.isReady()

    const wrapper = mount(MonitorsView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    await wrapper.find('button.gc-monitor-page__card').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/certificates?certificateId=cert-1')
  })

  it('风险卡片加载失败时展示 requestId 相关错误文案入口', async () => {
    monitorMocks.listDashboardRisks.mockRejectedValueOnce(new ApiClientError('无权限', {
      errorCode: 'PERMISSION_DENIED',
      requestId: 'req_risk_denied',
      status: 403
    }))
    const router = createTestRouter('/monitors')
    router.push('/monitors')
    await router.isReady()

    const wrapper = mount(MonitorsView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('风险卡片加载失败')
    expect(wrapper.text()).toContain('无权限')
  })

  it('工作流模板编辑器会校验变量、拦截明文敏感字段，并且发布必须二次确认', async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const wrapper = mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } }
    })
    await flushPromises()
    clickBodyButton('新建模板')
    await flushPromises()

    expect(bodyText()).toContain('模板编辑器')
    expect(bodyText()).toContain('后端模板 API 尚未稳定')
    expect(bodyText()).toContain('Capability 需求声明')

    const commandEditor = bodyFormControls<HTMLTextAreaElement>('textarea')[0]!
    commandEditor.value = 'curl -H "Authorization: token=sk-aaaaaaaaaaaaaaaaaaaaaaaa" https://${domainName}'
    commandEditor.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(bodyText()).toContain('模板不能包含私钥、password、token 或 API Key 明文')
    const dryRunButton = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Dry-run 预览') as HTMLButtonElement | undefined
    expect(dryRunButton?.disabled).toBe(true)
    expect(localStorageSpy).not.toHaveBeenCalled()

    commandEditor.value = 'curl --cert ${certificateSecretRef} https://${domainName}'
    commandEditor.dispatchEvent(new Event('input', { bubbles: true }))
    const changeNoteInput = bodyFormControls<HTMLInputElement>('input')[1]!
    changeNoteInput.value = '使用 SecretRef 验证 CURL 模板'
    changeNoteInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    clickBodyButton('Dry-run 预览')
    await flushPromises()
    expect(bodyText()).toContain('Dry-run 结果')
    expect(bodyText()).toContain('requestId：local_dry_run_')

    clickBodyButton('发布模板')
    await flushPromises()
    expect(bodyText()).not.toContain('已发布草案版本')
    const confirmInput = bodyFormControls<HTMLInputElement>('div[role="dialog"] input')[0]!
    confirmInput.value = 'PUBLISH'
    confirmInput.dispatchEvent(new Event('input', { bubbles: true }))
    clickBodyButton('确认')
    await flushPromises()
    expect(bodyText()).toContain('已发布草案版本')
  })

  it('执行日志区域明确使用轮询降级，不假装实时通道', () => {
    const wrapper = mount(GcExecutionLogViewer, {
      props: {
        mode: 'polling',
        polling: true,
        steps: [{ id: 'step-1', name: '备份证书', status: 'RUNNING', requestId: 'req_step' }],
        lines: [{ id: 'log-1', time: '2026-06-08T00:00:00.000Z', level: 'info', message: 'poll loaded', requestId: 'req_log' }]
      }
    })

    expect(wrapper.text()).toContain('降级轮询中')
    expect(wrapper.text()).toContain('不会假装实时推送')
    expect(wrapper.text()).toContain('轮询已启用')
    expect(wrapper.text()).toContain('requestId=req_step')
    expect(wrapper.text()).toContain('requestId=req_log')
  })
})
