import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { ApiClientError } from '@/api/client'
import GcExecutionLogViewer from '@/design-system/components/GcExecutionLogViewer.vue'
import { usePermissionStore } from '@/stores/permission.store'

const deploymentMocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listCertificates: vi.fn(),
  listCertificateVersions: vi.fn(),
  listCertificateFormats: vi.fn(),
  listDeploymentPlans: vi.fn(),
  listExecutionsByPlanId: vi.fn(),
  listExecutionStepsByRunId: vi.fn(),
  listAgentTaskLogsByTaskId: vi.fn(),
  streamExecutionDetail: vi.fn(),
  createDeploymentPlan: vi.fn(),
  createDeploymentPlanFromApplicationAsset: vi.fn(),
  updateDeploymentPlanFromApplicationAsset: vi.fn(),
  cancelDeploymentPlan: vi.fn(),
  deleteDraftDeploymentPlan: vi.fn(),
  dryRunDeploymentPlan: vi.fn(),
  submitDeploymentPlan: vi.fn(),
  executeDeploymentPlan: vi.fn(),
  retryExecution: vi.fn(),
  rollbackExecution: vi.fn(),
}))

const dashboardMocks = vi.hoisted(() => ({
  listDashboardRisks: vi.fn(),
}))

const bindingMocks = vi.hoisted(() => ({
  listBindings: vi.fn(),
}))

const monitorMocks = vi.hoisted(() => ({
  listMonitors: vi.fn(),
  listMonitorTargets: vi.fn(),
  createMonitorTarget: vi.fn(),
  updateMonitorTarget: vi.fn(),
  deleteMonitorTarget: vi.fn(),
  listRiskEvents: vi.fn(),
  listMonitorCertificateObservations: vi.fn(),
  probeMonitorServiceAsset: vi.fn(),
  scanMonitorRisks: vi.fn(),
}))

const workflowMocks = vi.hoisted(() => ({
  listWorkflowTemplates: vi.fn(),
  createWorkflowTemplate: vi.fn(),
  listWorkflowTemplateVersions: vi.fn(),
  createWorkflowTemplateVersion: vi.fn(),
  publishWorkflowTemplateVersion: vi.fn(),
}))

vi.mock('@/api/modules/assets.api', () => ({
  listAssets: deploymentMocks.listAssets,
}))

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificates: deploymentMocks.listCertificates,
  listCertificateVersions: deploymentMocks.listCertificateVersions,
  listCertificateFormats: deploymentMocks.listCertificateFormats,
}))

vi.mock('@/api/modules/deployments.api', () => ({
  listDeploymentPlans: deploymentMocks.listDeploymentPlans,
  createDeploymentPlan: deploymentMocks.createDeploymentPlan,
  createDeploymentPlanFromApplicationAsset: deploymentMocks.createDeploymentPlanFromApplicationAsset,
  updateDeploymentPlanFromApplicationAsset: deploymentMocks.updateDeploymentPlanFromApplicationAsset,
  cancelDeploymentPlan: deploymentMocks.cancelDeploymentPlan,
  deleteDraftDeploymentPlan: deploymentMocks.deleteDraftDeploymentPlan,
  dryRunDeploymentPlan: deploymentMocks.dryRunDeploymentPlan,
  submitDeploymentPlan: deploymentMocks.submitDeploymentPlan,
  executeDeploymentPlan: deploymentMocks.executeDeploymentPlan,
}))

vi.mock('@/api/modules/executions.api', () => ({
  listExecutionsByPlanId: deploymentMocks.listExecutionsByPlanId,
  listExecutionStepsByRunId: deploymentMocks.listExecutionStepsByRunId,
  listAgentTaskLogsByTaskId: deploymentMocks.listAgentTaskLogsByTaskId,
  streamExecutionDetail: deploymentMocks.streamExecutionDetail,
  retryExecution: deploymentMocks.retryExecution,
  rollbackExecution: deploymentMocks.rollbackExecution,
}))

vi.mock('@/api/modules/dashboard.api', () => ({
  listDashboardRisks: dashboardMocks.listDashboardRisks,
}))

vi.mock('@/api/modules/bindings.api', () => ({
  listBindings: bindingMocks.listBindings,
}))

vi.mock('@/api/modules/monitors.api', () => ({
  listMonitors: monitorMocks.listMonitors,
  listMonitorTargets: monitorMocks.listMonitorTargets,
  createMonitorTarget: monitorMocks.createMonitorTarget,
  updateMonitorTarget: monitorMocks.updateMonitorTarget,
  deleteMonitorTarget: monitorMocks.deleteMonitorTarget,
  listRiskEvents: monitorMocks.listRiskEvents,
  listMonitorCertificateObservations: monitorMocks.listMonitorCertificateObservations,
  probeMonitorServiceAsset: monitorMocks.probeMonitorServiceAsset,
  scanMonitorRisks: monitorMocks.scanMonitorRisks,
}))

vi.mock('@/api/modules/workflow-templates.api', () => ({
  listWorkflowTemplates: workflowMocks.listWorkflowTemplates,
  createWorkflowTemplate: workflowMocks.createWorkflowTemplate,
  listWorkflowTemplateVersions: workflowMocks.listWorkflowTemplateVersions,
  createWorkflowTemplateVersion: workflowMocks.createWorkflowTemplateVersion,
  publishWorkflowTemplateVersion: workflowMocks.publishWorkflowTemplateVersion,
}))

import DeploymentPlansView from '@/views/deployments/DeploymentPlansView.vue'
import MonitorsView from '@/views/monitoring/MonitorsView.vue'
import WorkflowTemplatesView from '@/views/workflows/WorkflowTemplatesView.vue'

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_ok',
    timestamp: '2026-06-08T00:00:00.000Z',
  }
}

function okList(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, total: items.length, page: 1, pageSize: 200 },
    requestId: 'req_ok',
    timestamp: '2026-06-08T00:00:00.000Z',
  }
}

function clickBodyButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) as HTMLButtonElement | undefined
  expect(button).toBeTruthy()
  button!.click()
}

function fillConfirmText(value: string) {
  const input = [...document.body.querySelectorAll('input')].find((item) => item.closest('.gc-confirm')) as HTMLInputElement | undefined
  expect(input).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
}

function bodyText() {
  return document.body.textContent ?? ''
}

function createTestRouter(path = '/deployment-plans') {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployment-plans', component: DeploymentPlansView },
      { path: '/certificates', component: { template: '<div>certificates</div>' } },
      { path: '/bindings', component: { template: '<div>bindings</div>' } },
      { path: '/executions', component: { template: '<div>executions</div>' } },
      { path: '/monitors', component: MonitorsView },
    ],
  })
}

describe('spec028 前端闭环', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions([
      'deployment.plan.write',
      'deployment.plan.read',
      'deployment.plan.execute',
      'execution.rollback',
      'monitor.read',
      'monitor.write',
      'workflow.template.read',
      'workflow.template.write',
    ])

    deploymentMocks.listAssets.mockResolvedValue(okPage([
      {
        id: 'asset-1',
        address: 'a.example.com',
        displayName: 'a.example.com',
        targetBinding: { managedTargetId: 'target-1', siteAssetId: 'site-1' },
        targetBindingDetail: {
          siteAsset: {
            siteName: 'SITE-1',
            bindingInformation: '*:443:a.example.com',
          },
        },
      },
    ]))
    deploymentMocks.listCertificates.mockResolvedValue(okPage([
      { id: 'cert-1', primaryDomain: 'a.example.com' },
    ]))
    deploymentMocks.listCertificateVersions.mockResolvedValue(okPage([
      {
        id: 'certver-1',
        certificateAssetId: 'cert-1',
        notBefore: '2026-06-01T00:00:00.000Z',
        notAfter: '2026-12-01T00:00:00.000Z',
      },
    ]))
    deploymentMocks.listCertificateFormats.mockResolvedValue(okPage([
      {
        id: 'fmt-1',
        format: 'pem',
        containsPrivateKey: true,
        parameters: { systemPlatform: 'linux', runtimePlatform: 'nginx', configName: 'Linux-NGINX-PEM' },
      },
      {
        id: 'fmt-2',
        format: 'pfx',
        containsPrivateKey: true,
        parameters: { systemPlatform: 'windows', runtimePlatform: 'iis', configName: 'Windows-IIS-PFX' },
      },
    ]))
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([]))
    deploymentMocks.listExecutionsByPlanId.mockResolvedValue(okPage([]))
    deploymentMocks.listExecutionStepsByRunId.mockResolvedValue(okPage([]))
    deploymentMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })
    deploymentMocks.streamExecutionDetail.mockResolvedValue(() => {})
    deploymentMocks.createDeploymentPlanFromApplicationAsset.mockResolvedValue({
      data: { id: 'plan-1' },
      requestId: 'req_create',
      timestamp: '2026-06-08T00:00:00.000Z',
    })
    deploymentMocks.updateDeploymentPlanFromApplicationAsset.mockResolvedValue({
      data: { id: 'plan-draft-1' },
      requestId: 'req_update',
      timestamp: '2026-06-08T00:00:00.000Z',
    })
    deploymentMocks.dryRunDeploymentPlan.mockResolvedValue({
      data: { run: { id: 'run-dry-1', status: 'RUNNING', type: 'dry_run' } },
      requestId: 'req_dry',
      timestamp: '2026-06-08T00:00:00.000Z',
    })
    deploymentMocks.submitDeploymentPlan.mockResolvedValue({
      data: { id: 'plan-1', status: 'READY' },
      requestId: 'req_submit',
      timestamp: '2026-06-08T00:00:00.000Z',
    })
    deploymentMocks.executeDeploymentPlan.mockResolvedValue({
      data: { run: { id: 'run-apply-1', status: 'RUNNING', type: 'apply' } },
      requestId: 'req_execute',
      timestamp: '2026-06-08T00:00:00.000Z',
    })
    deploymentMocks.retryExecution.mockResolvedValue({
      data: { run: { id: 'run-retry-1', status: 'RUNNING', type: 'apply' } },
      requestId: 'req_retry',
      timestamp: '2026-06-08T00:00:00.000Z',
    })
    deploymentMocks.rollbackExecution.mockResolvedValue({
      data: { run: { id: 'run-rollback-1', status: 'RUNNING', type: 'rollback' } },
      requestId: 'req_rollback',
      timestamp: '2026-06-08T00:00:00.000Z',
    })

    dashboardMocks.listDashboardRisks.mockResolvedValue(okPage([
      { id: 'risk-1', title: '证书即将过期', risk: 'HIGH', status: 'READY', certificateId: 'cert-1' },
    ]))
    bindingMocks.listBindings.mockResolvedValue(okPage([]))
    monitorMocks.listMonitors.mockResolvedValue(okPage([]))
    monitorMocks.listMonitorTargets.mockResolvedValue(okPage([]))
    monitorMocks.listRiskEvents.mockResolvedValue(okPage([]))
    monitorMocks.listMonitorCertificateObservations.mockResolvedValue(okPage([]))
    monitorMocks.probeMonitorServiceAsset.mockResolvedValue({
      data: {
        status: 'READY',
        latencyMs: 12,
        checkedAt: '2026-06-08T00:00:00.000Z',
        message: '探测完成',
        source: 'control_plane',
      },
    })
    monitorMocks.scanMonitorRisks.mockResolvedValue({ data: { ok: true } })

    workflowMocks.listWorkflowTemplates.mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'curl-template',
        status: 'draft',
        currentVersionId: 'ver-1',
        createdAt: '2026-06-08T00:00:00.000Z',
        updatedAt: '2026-06-08T00:00:00.000Z',
      },
    ]))
    workflowMocks.createWorkflowTemplate.mockResolvedValue({ data: { id: 'tpl-2' } })
    workflowMocks.listWorkflowTemplateVersions.mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            version: '1',
            status: 'draft',
            changeSummary: '初始草稿',
            createdAt: '2026-06-08T00:00:00.000Z',
          },
        ],
      },
    })
    workflowMocks.createWorkflowTemplateVersion.mockResolvedValue({ data: { id: 'ver-2' } })
    workflowMocks.publishWorkflowTemplateVersion.mockResolvedValue({ data: { ok: true } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('部署向导可以发起 dry-run，并显示统一后的任务流模态框', async () => {
    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    mount(DeploymentPlansView, {
      attachTo: document.body,
      global: {
        plugins: [router],
        stubs: { teleport: true, Teleport: true },
      },
    })
    await flushPromises()

    clickBodyButton('创建部署计划')
    await flushPromises()

    expect(bodyText()).toContain('选择部署目标')
    expect(bodyText()).toContain('预检并提交')
    expect(bodyText()).toContain('Linux-NGINX-PEM')

    clickBodyButton('下一步')
    await flushPromises()
    clickBodyButton('下一步')
    await flushPromises()
    clickBodyButton('先做 Dry-run')
    await flushPromises()

    expect(deploymentMocks.createDeploymentPlanFromApplicationAsset).toHaveBeenCalledWith(expect.objectContaining({
      applicationAssetId: 'asset-1',
      certificateFormatId: 'fmt-1',
    }))
    expect(deploymentMocks.dryRunDeploymentPlan).toHaveBeenCalledWith({ planId: 'plan-1' })
    expect(bodyText()).toContain('Dry-run 结果')
    expect(bodyText()).toContain('等待后端返回执行步骤')
    expect(bodyText()).toContain('任务进度')
  })

  it('部署计划草稿可以用创建视图回填并保存编辑', async () => {
    deploymentMocks.listAssets.mockResolvedValue(okPage([
      {
        id: 'asset-1',
        address: 'a.example.com',
        displayName: 'a.example.com',
        targetBinding: { managedTargetId: 'target-1', siteAssetId: 'site-1' },
        targetBindingDetail: {
          siteAsset: {
            siteName: 'SITE-1',
            bindingInformation: '*:443:a.example.com',
          },
          certificateBindings: [{ id: 'binding-1' }],
        },
      },
    ]))
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([
      {
        id: 'plan-draft-1',
        name: 'a.example.com 证书部署',
        status: 'DRAFT',
        risk: 'MEDIUM',
        certificateVersionId: 'certver-1',
        certificateFormatId: 'fmt-1',
        targets: [{ certificateBindingId: 'binding-1', executionTargetId: 'target-1' }],
      },
    ]))

    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    mount(DeploymentPlansView, {
      attachTo: document.body,
      global: {
        plugins: [router],
        stubs: { teleport: true, Teleport: true },
      },
    })
    await flushPromises()

    clickBodyButton('编辑计划')
    await flushPromises()

    expect(bodyText()).toContain('部署向导')
    expect(bodyText()).toContain('Linux-NGINX-PEM')

    clickBodyButton('下一步')
    await flushPromises()
    clickBodyButton('下一步')
    await flushPromises()
    clickBodyButton('保存计划')
    await flushPromises()

    expect(deploymentMocks.deleteDraftDeploymentPlan).not.toHaveBeenCalled()
    expect(deploymentMocks.updateDeploymentPlanFromApplicationAsset).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-draft-1',
      applicationAssetId: 'asset-1',
      targetCertificateVersionId: 'certver-1',
      certificateFormatId: 'fmt-1',
      selectionMode: 'EXPLICIT',
    }))
  })

  it('已执行部署计划进入编辑视图后会直接更新原计划', async () => {
    deploymentMocks.updateDeploymentPlanFromApplicationAsset.mockClear()
    deploymentMocks.createDeploymentPlanFromApplicationAsset.mockClear()
    deploymentMocks.listAssets.mockResolvedValue(okPage([
      {
        id: 'asset-1',
        address: 'a.example.com',
        displayName: 'a.example.com',
        targetBinding: { managedTargetId: 'target-1', siteAssetId: 'site-1' },
        targetBindingDetail: {
          siteAsset: {
            siteName: 'SITE-1',
            bindingInformation: '*:443:a.example.com',
          },
          certificateBindings: [{ id: 'binding-1' }],
        },
      },
    ]))
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([
      {
        id: 'plan-success-1',
        name: 'a.example.com 证书部署',
        status: 'SUCCESS',
        risk: 'MEDIUM',
        certificateVersionId: 'certver-1',
        certificateFormatId: 'fmt-1',
        targets: [{ certificateBindingId: 'binding-1', executionTargetId: 'target-1' }],
      },
    ]))

    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    mount(DeploymentPlansView, {
      attachTo: document.body,
      global: {
        plugins: [router],
        stubs: { teleport: true, Teleport: true },
      },
    })
    await flushPromises()

    clickBodyButton('编辑计划')
    await flushPromises()

    expect(bodyText()).toContain('部署向导')
    expect(bodyText()).not.toContain('创建新的部署草稿')

    clickBodyButton('下一步')
    await flushPromises()
    clickBodyButton('下一步')
    await flushPromises()
    clickBodyButton('保存计划')
    await flushPromises()

    expect(deploymentMocks.createDeploymentPlanFromApplicationAsset).not.toHaveBeenCalled()
    expect(deploymentMocks.updateDeploymentPlanFromApplicationAsset).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-success-1',
      applicationAssetId: 'asset-1',
      targetCertificateVersionId: 'certver-1',
      certificateFormatId: 'fmt-1',
      selectionMode: 'EXPLICIT',
    }))
  })

  it('执行部署缺少有效 dry-run 时，会弹出前端确认模态框引导用户先做 dry-run', async () => {
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([
      {
        id: 'plan-success',
        name: '已完成计划',
        status: 'SUCCESS',
        risk: 'HIGH',
        latestRunId: 'run-apply-1',
        latestRun: { id: 'run-apply-1', status: 'SUCCESS', type: 'dry_run' },
      },
    ]))
    deploymentMocks.executeDeploymentPlan.mockRejectedValue(
      new ApiClientError('正式执行前必须先完成一次成功的 Dry-run 影响预览。', {
        errorCode: 'DRY_RUN_REQUIRED',
        requestId: 'req_execute_failed',
        status: 409,
      }),
    )

    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    mount(DeploymentPlansView, {
      attachTo: document.body,
      global: {
        plugins: [router],
        stubs: { teleport: true, Teleport: true },
      },
    })
    await flushPromises()

    clickBodyButton('执行部署')
    await flushPromises()
    fillConfirmText('EXECUTE')
    await flushPromises()
    clickBodyButton('确认')
    await flushPromises()

    expect(bodyText()).toContain('需要先执行 Dry-run')
    expect(bodyText()).toContain('正式执行前必须先完成一次成功的 Dry-run 影响预览。')
    expect(bodyText()).toContain('先做 Dry-run')

    clickBodyButton('先做 Dry-run')
    await flushPromises()

    expect(bodyText()).not.toContain('需要先执行 Dry-run')
    expect(bodyText()).toContain('Dry-run 结果')
  })

  it('部署计划列表按状态显示执行和回滚动作', async () => {
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([
      {
        id: 'plan-approved',
        name: '生产证书部署',
        status: 'APPROVED',
        risk: 'HIGH',
        approvalId: 'approval-1',
        snapshotHash: 'sha256:abc',
        failureReason: 'gateway timeout',
      },
      {
        id: 'plan-failed',
        name: '失败计划',
        status: 'FAILED',
        risk: 'HIGH',
        latestRunId: 'run-failed',
        latestRun: { id: 'run-failed', status: 'FAILED', type: 'apply' },
        failureReason: 'agent offline',
      },
    ]))

    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    const wrapper = mount(DeploymentPlansView, {
      global: {
        plugins: [router],
        stubs: { teleport: true, Teleport: true },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('生产证书部署')
    expect(wrapper.text()).toContain('失败计划')
    expect(wrapper.text()).toContain('执行部署')
    expect(wrapper.text()).not.toContain('重新执行')
    expect(wrapper.text()).not.toContain('重试执行')
    expect(wrapper.text()).toContain('回滚执行')
  })

  it('执行部署模态框不会继承上一次 dry-run 的错误文案', async () => {
    deploymentMocks.listDeploymentPlans.mockResolvedValue(okPage([
      {
        id: 'plan-ready-1',
        name: '跨适配器计划',
        status: 'SUCCESS',
        risk: 'HIGH',
        latestRunId: 'run-dry-success-1',
        latestRun: { id: 'run-dry-success-1', status: 'SUCCESS', type: 'dry_run' },
      },
    ]))
    deploymentMocks.dryRunDeploymentPlan.mockRejectedValueOnce(
      new ApiClientError('NGINX 部署目标缺少 certPath/keyPath，无法生成 Agent 执行 payload', {
        errorCode: 'VALIDATION_FAILED',
        requestId: 'req_dry_failed',
        status: 400,
      }),
    )

    const router = createTestRouter()
    router.push('/deployment-plans')
    await router.isReady()

    mount(DeploymentPlansView, {
      attachTo: document.body,
      global: {
        plugins: [router],
        stubs: { teleport: true, Teleport: true },
      },
    })
    await flushPromises()

    clickBodyButton('Dry-run 影响预览')
    await flushPromises()

    expect(bodyText()).toContain('NGINX 部署目标缺少 certPath/keyPath，无法生成 Agent 执行 payload')

    clickBodyButton('关闭')
    await flushPromises()

    clickBodyButton('执行部署')
    await flushPromises()
    fillConfirmText('EXECUTE')
    await flushPromises()
    clickBodyButton('确认')
    await flushPromises()

    expect(bodyText()).toContain('证书更新执行')
    expect(bodyText()).not.toContain('NGINX 部署目标缺少 certPath/keyPath，无法生成 Agent 执行 payload')
  })

  it('风险卡片会跳转到证书上下文页面', async () => {
    monitorMocks.listMonitorTargets.mockResolvedValue(okPage([
      {
        id: 'target-1',
        serviceAssetId: 'asset-1',
        metrics: ['availability', 'certificate'],
        intervalSeconds: 60,
        createdAt: '2026-06-08T00:00:00.000Z',
      },
    ]))
    monitorMocks.listRiskEvents.mockResolvedValue(okPage([
      {
        id: 'risk-1',
        title: '证书即将过期',
        summary: 'a.example.com 证书即将过期',
        risk: 'HIGH',
        status: 'OPEN',
        certificateId: 'cert-1',
        serviceAssetId: 'asset-1',
      },
    ]))
    const router = createTestRouter('/monitors')
    router.push('/monitors')
    await router.isReady()

    const wrapper = mount(MonitorsView, {
      global: {
        plugins: [router],
        stubs: { RouterLink: false },
      },
    })
    await flushPromises()
    await flushPromises()

    await wrapper.find('a.monitor-page__risk-link').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/certificates?certificateId=cert-1')
  })

  it('监控页面清理本地监控数据并从后端加载监控目标', async () => {
    localStorage.setItem('gcac.monitor.targets.v1', JSON.stringify([{ id: 'local-target', assetId: 'asset-1' }]))
    localStorage.setItem('gcac.monitor.probe-history.v1', JSON.stringify({ 'asset-1': [] }))
    monitorMocks.listMonitorTargets.mockResolvedValue(okPage([
      {
        id: 'target-1',
        serviceAssetId: 'asset-1',
        metrics: ['availability', 'latency'],
        intervalSeconds: 120,
        createdAt: '2026-06-08T00:00:00.000Z',
      },
    ]))

    const router = createTestRouter('/monitors')
    router.push('/monitors')
    await router.isReady()

    const wrapper = mount(MonitorsView, {
      global: {
        plugins: [router],
        stubs: { teleport: true, Teleport: true },
      },
    })
    await flushPromises()

    expect(localStorage.getItem('gcac.monitor.targets.v1')).toBeNull()
    expect(localStorage.getItem('gcac.monitor.probe-history.v1')).toBeNull()
    expect(monitorMocks.listMonitorTargets).toHaveBeenCalled()
    expect(wrapper.text()).toContain('a.example.com')
  })

  it('工作流详情可加载版本并发布草稿版本', async () => {
    const wrapper = mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('详情')
    await flushPromises()

    expect(bodyText()).toContain('工作流')
    expect(bodyText()).not.toContain('工作流模板管理')
    clickBodyButton('版本')
    await flushPromises()
    expect(bodyText()).toContain('初始草稿')

    clickBodyButton('发布版本')
    await flushPromises()

    expect(workflowMocks.publishWorkflowTemplateVersion).toHaveBeenCalledWith('ver-1')
  })

  it('执行日志组件明确显示自动刷新兜底文案', () => {
    const wrapper = mount(GcExecutionLogViewer, {
      props: {
        mode: 'live',
        polling: true,
        streaming: false,
        steps: [{ id: 'step-1', name: '备份证书', status: 'RUNNING', requestId: 'req_step' }],
        lines: [{ id: 'log-1', time: '2026-06-08T00:00:00.000Z', level: 'info', message: 'poll loaded', requestId: 'req_log' }],
      },
    })

    expect(wrapper.text()).toContain('自动刷新')
    expect(wrapper.text()).toContain('任务状态与日志会自动刷新')
    expect(wrapper.text()).toContain('当前处于刷新兜底模式')
  })
})
