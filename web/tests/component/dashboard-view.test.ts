import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DashboardView from '@/views/dashboard/DashboardView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  getDashboardOverview: vi.fn(),
}))

vi.mock('@/api/modules/dashboard.api', () => ({
  getDashboardOverview: apiMocks.getDashboardOverview,
}))

describe('DashboardView', () => {
  beforeEach(() => {
    apiMocks.getDashboardOverview.mockReset()
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['audit.read'])
  })

  it('首页审计日志展示中文摘要并隐藏原始事件、风险和明细', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        metrics: [],
        quickActions: [],
        statusGroups: [],
        certificateStatuses: [],
        recentAudits: [
          {
            id: 'aud-1',
            eventType: 'deployment.executed',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'execution.apply.enqueue',
            resourceType: 'executionRun',
            resourceId: 'run_1',
            result: 'success',
            riskLevel: 'high',
            requestId: 'req_secret_001',
            createdAt: '2026-07-06T08:34:00.000Z',
            summary: '用户 user_admin完成“执行部署”，部署计划：生产 NGINX 证书更新，资产：生产 API 网关。',
            detail: {
              purpose: 'certificate.export',
              secretRef: 'secret://password/sec-prod-db-password/1',
              fingerprint: 'sha256:abcdef123456',
              token: '不应该展示',
            },
          },
        ],
      },
      requestId: 'req_dashboard',
      timestamp: '2026-07-06T08:34:00.000Z',
    })

    const wrapper = mount(DashboardView)

    await vi.waitFor(() => expect(wrapper.text()).toContain('执行部署'))
    const auditList = wrapper.find('.dashboard-audits')
    const auditText = auditList.text()
    expect(auditText).toContain('部署')
    expect(auditText).toContain('成功')
    expect(auditText).toContain('部署计划：生产 NGINX 证书更新')
    expect(auditText).toContain('资产：生产 API 网关')
    expect(auditText).not.toContain('高风险')
    expect(auditText).not.toContain('用途')
    expect(auditText).not.toContain('certificate.export')
    expect(auditText).not.toContain('SecretRef')
    expect(auditText).not.toContain('secret://password/sec-prod-db-password/1')
    expect(auditText).not.toContain('deployment.executed')
    expect(auditText).not.toContain('不应该展示')
    expect(auditList.find('.dashboard-audits__event').exists()).toBe(false)
    expect(auditList.find('.dashboard-audits__risk').exists()).toBe(false)
    expect(auditList.find('.dashboard-audits__details').exists()).toBe(false)
  })

  it('使用 Cloud Security Pro 页面头和核心指标区域', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        metrics: [{ key: 'applications', title: '应用', value: 4, description: '已纳管应用', trend: 'good' }],
        quickActions: [],
        statusGroups: [
          {
            key: 'certificates',
            title: '证书',
            summary: '正常',
            total: 1,
            blocks: [{ id: 'cert-1', label: 'api.example.com', status: '正常', tone: 'ok' }],
          },
        ],
        certificateStatuses: [],
        recentAudits: [],
      },
    })

    const wrapper = mount(DashboardView)

    await vi.waitFor(() => {
      expect(wrapper.find('.dashboard-page__header').exists()).toBe(true)
      expect(wrapper.find('.dashboard-metric').text()).toContain('4')
    })
    expect(wrapper.find('.dashboard-page__header').text()).toContain('总览')
    expect(wrapper.find('.dashboard-page__header .gc-button').exists()).toBe(true)
    expect(wrapper.find('.dashboard-status-summary .gc-donut-chart').exists()).toBe(true)
    expect(wrapper.find('.dashboard-status-summary .gc-donut-chart__segment--success').exists()).toBe(true)
    expect(wrapper.find('.dashboard-status-summary__total').text()).toBe('1')
  })

  it('保留快捷入口权限过滤，并在没有有效趋势序列时显示诚实空态', async () => {
    usePermissionStore().setPermissions(['certificate.asset.read'])
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        metrics: [],
        quickActions: [
          {
            key: 'certificates',
            title: '证书管理',
            description: '导入、查看和转换证书。',
            path: '/certificates',
            permission: 'certificate.asset.read',
          },
          {
            key: 'agents',
            title: 'Agent',
            description: '查看在线状态和任务能力。',
            path: '/agents',
            permission: 'agent.read',
          },
        ],
        statusGroups: [
          {
            key: 'certificates',
            title: '证书',
            summary: '全部正常',
            total: 1,
            blocks: [{ id: 'cert-1', label: 'api.example.com', status: '正常', tone: 'ok' }],
          },
          {
            key: 'agents',
            title: 'Agent',
            summary: '全部正常',
            total: 0,
            blocks: [],
          },
        ],
        certificateStatuses: [],
        recentAudits: [
          {
            id: 'aud-1',
            eventType: 'auth.login.success',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'auth.login',
            resourceType: 'authSession',
            result: 'success',
            riskLevel: 'low',
            createdAt: '2026-07-06T08:34:00.000Z',
          },
        ],
      },
    })

    const wrapper = mount(DashboardView)

    await vi.waitFor(() => expect(wrapper.findAll('.dashboard-action')).toHaveLength(1))
    expect(wrapper.find('.dashboard-status-group').exists()).toBe(true)
    expect(wrapper.findAll('.dashboard-status-group')).toHaveLength(2)
    expect(wrapper.find('[data-testid="dashboard-activity-chart"] .gc-trend-chart__empty').exists()).toBe(true)
  })

  it('仅用最近审计事件时间聚合活动趋势，不生成示例静态数据', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        metrics: [],
        quickActions: [],
        statusGroups: [],
        certificateStatuses: [],
        recentAudits: [
          {
            id: 'aud-1',
            eventType: 'auth.login.success',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'auth.login',
            resourceType: 'authSession',
            result: 'success',
            riskLevel: 'low',
            createdAt: '2026-07-06T08:34:00.000Z',
          },
          {
            id: 'aud-2',
            eventType: 'auth.logout',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'auth.logout',
            resourceType: 'authSession',
            result: 'success',
            riskLevel: 'low',
            createdAt: '2026-07-06T09:34:00.000Z',
          },
        ],
      },
    })

    const wrapper = mount(DashboardView)

    await vi.waitFor(() => expect(wrapper.find('[data-testid="dashboard-activity-chart"] .gc-trend-chart__line').exists()).toBe(true))
    expect(wrapper.find('[data-testid="dashboard-activity-chart"] .gc-trend-chart__empty').exists()).toBe(false)
  })
})
