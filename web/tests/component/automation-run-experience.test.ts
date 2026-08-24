import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AutomationPreviewPanel from '@/views/automations/AutomationPreviewPanel.vue'
import AutomationRunDetail from '@/views/automations/AutomationRunDetail.vue'

const apiMocks = vi.hoisted(() => ({
  getAutomationRun: vi.fn(),
  listAutomationRunTargets: vi.fn(),
  retryAutomationRun: vi.fn(),
  stopAutomationRun: vi.fn(),
  listTasks: vi.fn(),
  push: vi.fn()
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'run-1' } }),
  useRouter: () => ({ push: apiMocks.push })
}))

vi.mock('@/api/modules/automations.api', () => ({
  getAutomationRun: apiMocks.getAutomationRun,
  listAutomationRunTargets: apiMocks.listAutomationRunTargets,
  retryAutomationRun: apiMocks.retryAutomationRun,
  stopAutomationRun: apiMocks.stopAutomationRun
}))

vi.mock('@/api/modules/tasks.api', () => ({
  listTasks: apiMocks.listTasks,
}))

describe('Spec 030 预览和运行体验', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.getAutomationRun.mockResolvedValue({
      id: 'run-1',
      automationId: 'automation-1',
      automationNameSnapshot: '生产证书更新',
      automationVersion: 3,
      triggerType: 'on_demand',
      status: 'failed',
      targetSummary: { total: 2, pending: 0, running: 0, waitingApproval: 0, succeeded: 1, failed: 1, skipped: 0, cancelled: 0 },
      failureStage: 'verification',
      createdAt: '2026-07-21T02:00:00.000Z',
      startedAt: '2026-07-21T02:00:01.000Z',
      finishedAt: '2026-07-21T02:00:05.000Z',
      actionResults: []
    })
    apiMocks.listAutomationRunTargets.mockResolvedValue([{ id: 'target-1', sequenceNo: 1, targetSnapshot: { certificateName: 'example.com', assetName: '生产网关', environment: 'production' }, status: 'failed', failureStage: 'verification', errorCode: 'VERIFY_FAILED', errorMessage: '验证失败', deploymentPlanId: 'plan-1', executionRunId: 'execution-1', notificationRequestIds: [] }])
    apiMocks.retryAutomationRun.mockResolvedValue({ id: 'run-retry' })
    apiMocks.stopAutomationRun.mockResolvedValue(undefined)
    apiMocks.listTasks.mockResolvedValue({
      data: {
        items: [{
          id: 'task-dry-run-1',
          tenantId: 'tenant-1',
          taskType: 'CERTIFICATE_DRY_RUN',
          definitionVersion: 1,
          category: 'EXECUTION',
          status: 'SUCCEEDED',
          requestedBy: 'user_admin',
          triggerSource: 'execution.dry_run.enqueue',
          resourceSummary: { percent: 100 },
          payload: {},
          progress: { summary: '预检已完成', percent: 100 },
          createdAt: '2026-07-21T02:00:02.000Z',
        }],
      },
    })
  })

  it('展示命中、排除原因并确认按需执行', async () => {
    const wrapper = mount(AutomationPreviewPanel, {
      props: {
        preview: {
          previewId: 'preview-1', totalMatched: 2, executableCount: 1, excludedCount: 1,
          excludedReasons: { environment_not_allowed: 1 },
          items: [
            { target: { bindingId: 'binding-1', certificateName: 'example.com', environment: 'production' }, executable: true },
            { target: { bindingId: 'binding-2', certificateName: 'blocked.example.com' }, executable: false, excludedReason: 'environment_not_allowed' }
          ]
        }
      },
      global: { plugins: [i18n] }
    })

    expect(wrapper.text()).toContain('匹配 2 项')
    expect(wrapper.text()).toContain('环境不在允许范围')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('展示已选资产的证书版本影响，而不是展示旧匹配计数', async () => {
    const upgradeCurrent = '2026-08-01T01:02:03.000Z'
    const targetExpiry = '2026-11-04T09:08:33.000Z'
    const sameCurrent = '2026-11-04T00:00:00.000Z'
    const wrapper = mount(AutomationPreviewPanel, {
      props: {
        preview: {
          previewId: 'preview-impact',
          totalMatched: 2,
          executableCount: 1,
          excludedCount: 1,
          excludedReasons: { certificate_already_up_to_date: 1 },
          versionImpactSummary: { total: 2, upgrade: 1, same: 1, downgrade: 0, missingCurrent: 0 },
          items: [
            { target: { bindingId: 'binding-upgrade', assetId: 'asset-a', assetName: '生产 Nginx', certificateName: 'example.com', currentCertificateNotAfter: upgradeCurrent, targetCertificateNotAfter: targetExpiry, certificateVersionImpact: 'upgrade' }, executable: true },
            { target: { bindingId: 'binding-same', assetId: 'asset-b', assetName: '灰度 Ingress', certificateName: 'example.com', currentCertificateNotAfter: sameCurrent, targetCertificateNotAfter: targetExpiry, certificateVersionImpact: 'same' }, executable: false, excludedReason: 'certificate_already_up_to_date' },
          ],
        },
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('受影响 2 项')
    expect(wrapper.text()).toContain('可执行 1 项')
    expect(wrapper.text()).toContain('跳过更新 1 项')
    expect(wrapper.text()).toContain('需关注 0 项')
    expect(wrapper.text()).toContain('生产 Nginx')
    expect(wrapper.text()).toContain('有效期')
    expect(wrapper.text()).toContain('2026-08-01 → 2026-11-04')
    expect(wrapper.text()).toContain('跳过更新')
    expect(wrapper.text()).not.toContain('版本 4')
    expect(wrapper.text()).not.toContain('匹配 2 项')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('即使后端 executableCount 为 0，只要存在可执行目标也允许执行', async () => {
    const wrapper = mount(AutomationPreviewPanel, {
      props: {
        preview: {
          previewId: 'preview-count-mismatch',
          totalMatched: 1,
          executableCount: 0,
          excludedCount: 0,
          excludedReasons: {},
          versionImpactSummary: { total: 1, upgrade: 1, same: 0, downgrade: 0, missingCurrent: 0 },
          items: [
            { target: { bindingId: 'binding-upgrade', assetId: 'asset-a', assetName: '生产 Nginx', certificateName: 'example.com', currentCertificateNotAfter: '2026-08-01T00:00:00.000Z', targetCertificateNotAfter: '2026-11-04T00:00:00.000Z', certificateVersionImpact: 'upgrade' }, executable: true },
          ],
        },
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('展示失败阶段并支持停止和失败重试', async () => {
    const wrapper = mount(AutomationRunDetail, { global: { plugins: [i18n] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('生产证书更新'))
    expect(wrapper.text()).toContain('验证')
    expect(wrapper.text()).toContain('生产网关')
    expect(wrapper.text()).toContain('证书Dry-run')
    expect(wrapper.text()).toContain('预检已完成')

    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text() === '停止运行')?.trigger('click')
    expect(apiMocks.stopAutomationRun).toHaveBeenCalledWith('run-1')

    await buttons.find((button) => button.text() === '重试失败目标')?.trigger('click')
    expect(apiMocks.retryAutomationRun).toHaveBeenCalledWith('run-1')
    expect(apiMocks.push).toHaveBeenCalledWith('/automation-runs/run-retry')
  })
})
