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
    executeDeploymentPlan: deploymentMocks.executeDeploymentPlan
  }
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
    usePermissionStore().setPermissions(['deployment.plan.write', 'deployment.plan.read', 'monitor.read', 'monitor.write'])
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
    monitorMocks.listMonitors.mockResolvedValue(okPage([]))
    monitorMocks.listDashboardRisks.mockResolvedValue(okPage([
      { id: 'risk-1', title: '证书即将过期', risk: 'HIGH', status: 'READY', certificateId: 'cert-1' }
    ]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('部署向导完成选择、dry-run 与提交闭环', async () => {
    const router = createTestRouter()
    router.push('/deployment-plans?certificateId=cert-1')
    await router.isReady()

    const wrapper = mount(DeploymentPlansView, {
      global: {
        plugins: [router]
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('部署向导最小闭环')
    expect(wrapper.text()).toContain('Capability 兼容性')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find((button) => button.text() === 'Dry-run')?.trigger('click')
    await flushPromises()
    expect(deploymentMocks.dryRunDeploymentPlan).toHaveBeenCalledWith(expect.objectContaining({ certificateId: 'cert-1', bindingIds: ['binding-1'] }))
    expect(wrapper.text()).toContain('最近 dry-run：req_dry')

    await wrapper.findAll('button').find((button) => button.text() === '提交计划')?.trigger('click')
    await flushPromises()
    expect(deploymentMocks.createDeploymentPlan).toHaveBeenCalled()
    expect(deploymentMocks.submitDeploymentPlan).toHaveBeenCalledWith('plan-1', expect.objectContaining({ certificateId: 'cert-1' }))
    expect(wrapper.text()).toContain('最近提交：req_submit')
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
    const wrapper = mount(WorkflowTemplatesView)
    await flushPromises()

    expect(wrapper.text()).toContain('模板编辑器')
    expect(wrapper.text()).toContain('后端模板 API 尚未稳定')
    expect(wrapper.text()).toContain('Capability 需求声明')

    const commandEditor = wrapper.findAll('textarea')[0]!
    await commandEditor.setValue('curl -H "Authorization: token=sk-aaaaaaaaaaaaaaaaaaaaaaaa" https://${domainName}')
    await flushPromises()
    expect(wrapper.text()).toContain('模板不能包含私钥、password、token 或 API Key 明文')
    expect(wrapper.findAll('button').find((button) => button.text() === 'Dry-run 预览')?.attributes('disabled')).toBeDefined()
    expect(localStorageSpy).not.toHaveBeenCalled()

    await commandEditor.setValue('curl --cert ${certificateSecretRef} https://${domainName}')
    await wrapper.findAll('input')[1]!.setValue('使用 SecretRef 验证 CURL 模板')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Dry-run 预览')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Dry-run 结果')
    expect(wrapper.text()).toContain('requestId：local_dry_run_')

    await wrapper.findAll('button').find((button) => button.text() === '发布模板')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('已发布草案版本')
    await wrapper.find('div[role="dialog"] input').setValue('PUBLISH')
    await wrapper.findAll('button').find((button) => button.text() === '确认')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已发布草案版本')
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
