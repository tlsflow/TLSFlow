import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DashboardView from '@/views/dashboard/DashboardView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  getDashboardOverview: vi.fn(),
  getDashboardResources: vi.fn(),
}))
const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock('@/api/modules/dashboard.api', () => ({
  getDashboardOverview: apiMocks.getDashboardOverview,
  getDashboardResources: apiMocks.getDashboardResources,
}))

vi.mock('@/views/acme/AcmeCertificateRequestModal.vue', () => ({
  default: {
    props: ['open'],
    emits: ['update:open'],
    template: '<div v-if="open" data-testid="acme-request-modal" />',
  },
}))
vi.mock('vue-router', () => ({
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  useRouter: () => routerMocks,
}))

describe('DashboardView', () => {
  beforeEach(() => {
    apiMocks.getDashboardOverview.mockReset()
    apiMocks.getDashboardResources.mockReset()
    apiMocks.getDashboardResources.mockResolvedValue({ data: { cpuUsage: 22, memoryUsage: 41 } })
    routerMocks.push.mockReset()
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['audit.read'])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('首页审计日志展示中文摘要并隐藏原始事件、风险和明细', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        systemResources: { cpuUsage: null, memoryUsage: 62 },
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
            presentation: {
              kind: 'deployment',
              params: {
                planName: '生产 NGINX 证书更新',
                targetNames: ['生产 API 网关'],
                targetCount: 1,
                deploymentAction: 'execute',
              },
            },
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

  it('使用全新指标矩阵、紧凑趋势卡和热力图状态区域', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        systemResources: { cpuUsage: 37, memoryUsage: 62 },
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
      expect(wrapper.find('.dashboard-metric-card').text()).toContain('4')
    })
    expect(wrapper.find('.dashboard-page__header').exists()).toBe(false)
    expect(wrapper.find('.dashboard-action').exists()).toBe(false)
    expect(wrapper.find('.dashboard-primary-grid').exists()).toBe(true)
    expect(wrapper.find('.dashboard-resource-card').exists()).toBe(true)
    expect(wrapper.find('.dashboard-card-description').exists()).toBe(false)
    expect(wrapper.findAll('.dashboard-resource-row')).toHaveLength(2)
    expect(wrapper.find('.dashboard-resource-card').text()).toContain('37%')
    expect(wrapper.find('.dashboard-resource-card').text()).toContain('62%')
    expect(wrapper.find('.dashboard-metric-card .gc-tag--success').exists()).toBe(false)
    expect(wrapper.find('.dashboard-metric-card__topline .dashboard-metric-card__value').exists()).toBe(true)
    expect(wrapper.find('.dashboard-quick-start').exists()).toBe(true)
    expect(wrapper.find('.dashboard-quick-start__meta').exists()).toBe(false)
    expect(wrapper.find('.dashboard-trend-card').exists()).toBe(true)
    expect(wrapper.findAll('.dashboard-trend-card .gc-trend-chart__axis-tick')).toHaveLength(0)
    expect(wrapper.find('.dashboard-panel--status-summary').exists()).toBe(false)
    expect(wrapper.find('.dashboard-panel--type-stats').exists()).toBe(false)
    expect(wrapper.find('.dashboard-status-row .dashboard-panel--asset-heatmap').exists()).toBe(true)
    expect(wrapper.find('.dashboard-status-row .dashboard-status-group').exists()).toBe(true)
    expect(wrapper.find('.dashboard-panel--wizard').exists()).toBe(true)
    expect(wrapper.find('.dashboard-panel--wizard .dashboard-panel__header p').exists()).toBe(false)
    expect(wrapper.find('.dashboard-panel--recent-log').exists()).toBe(true)

    const heatmapBlock = wrapper.find('.dashboard-heatmap__block-wrap')
    await heatmapBlock.trigger('mouseenter')
    expect(wrapper.find('.dashboard-heatmap__tooltip').exists()).toBe(true)
    expect(heatmapBlock.classes()).toContain('dashboard-heatmap__block-wrap--tooltip-open')
  })

  it('15 天内到期指标卡跳转到证书域名筛选列表', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-08-26T08:34:00.000Z',
        systemResources: { cpuUsage: 37, memoryUsage: 62 },
        metrics: [{
          key: 'expiringCertificates',
          title: '15 天内到期证书',
          value: 2,
          description: '需要安排续期或替换的证书。',
          trend: 'warning',
          targetPath: '/certificates?category=expiringSoon',
        }],
        quickActions: [],
        statusGroups: [],
        certificateStatuses: [],
        recentAudits: [],
      },
    })

    const wrapper = mount(DashboardView)

    await vi.waitFor(() => expect(wrapper.find('a.dashboard-metric-card').exists()).toBe(true))
    expect(wrapper.find('a.dashboard-metric-card').attributes('href')).toBe('/certificates?category=expiringSoon')
  })

  it('不展示没有证书版本 ID 的陈旧证书热力图块', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-08-18T08:57:00.000Z',
        systemResources: { cpuUsage: null, memoryUsage: 62 },
        metrics: [],
        quickActions: [],
        statusGroups: [{
          key: 'certificates',
          title: '证书',
          summary: '1 个需要关注',
          total: 2,
          blocks: [
            { id: 'certificate-empty', label: '*.ginease.cn', status: '未知', tone: 'unknown' },
            { id: 'certificate-live', label: '*.codingns.com', status: '正常', tone: 'ok' },
          ],
        }],
        certificateStatuses: [
          { certificateAssetId: 'certificate-empty', name: '*.ginease.cn', primaryDomain: '*.ginease.cn', state: 'unknown', bindingCount: 0 },
          { certificateAssetId: 'certificate-live', certificateVersionId: 'version-live', name: '*.codingns.com', primaryDomain: '*.codingns.com', state: 'valid', bindingCount: 0 },
        ],
        recentAudits: [],
      },
    })

    const wrapper = mount(DashboardView)

    await vi.waitFor(() => expect(wrapper.find('.dashboard-status-group').exists()).toBe(true))
    expect(wrapper.find('.dashboard-status-group__total').text()).toBe('1')
    expect(wrapper.findAll('.dashboard-heatmap__block-wrap')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('*.ginease.cn')
  })

  it('应用资产悬浮框展示当前证书剩余天数', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-08-13T00:00:00.000Z',
        systemResources: { cpuUsage: null, memoryUsage: 62 },
        metrics: [],
        quickActions: [],
        statusGroups: [
          {
            key: 'applicationAssets',
            title: '应用资产',
            summary: '全部正常',
            total: 1,
            blocks: [{
              id: 'asset-1',
              label: 'test02.jacksonz.cn',
              status: 'ACTIVE',
              tone: 'ok',
              details: {
                type: 'applicationAsset',
                name: 'test02.jacksonz.cn',
                platform: 'LINUX',
                protocolPort: 'HTTPS test02.jacksonz.cn:443',
                certificateDaysRemaining: 83,
              },
            }],
          },
        ],
        certificateStatuses: [],
        recentAudits: [],
      },
    })

    const wrapper = mount(DashboardView)
    await vi.waitFor(() => expect(wrapper.find('.dashboard-heatmap__block-wrap').exists()).toBe(true))

    await wrapper.find('.dashboard-heatmap__block-wrap').trigger('mouseenter')

    const tooltip = wrapper.find('.dashboard-heatmap__tooltip')
    expect(tooltip.text()).toContain('剩余证书天数')
    expect(tooltip.text()).toContain('83')
  })

  it('保留快速向导权限过滤，并在没有有效趋势序列时显示诚实空态', async () => {
    usePermissionStore().setPermissions(['certificate.asset.read'])
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        systemResources: { cpuUsage: null, memoryUsage: 62 },
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

    await vi.waitFor(() => expect(wrapper.findAll('.dashboard-wizard__step')).toHaveLength(1))
    expect(wrapper.findAll('.dashboard-action')).toHaveLength(0)
    expect(wrapper.find('.dashboard-status-group').exists()).toBe(true)
    expect(wrapper.findAll('.dashboard-status-group')).toHaveLength(2)
    expect(wrapper.find('[data-testid="dashboard-activity-chart"]').exists()).toBe(false)
  })

  it('快捷启动仅展示当前用户有权限执行的新增证书和应用部署操作', async () => {
    usePermissionStore().setPermissions(['certificate.import', 'service_asset.read'])
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        systemResources: { cpuUsage: 22, memoryUsage: 41 },
        metrics: [],
        quickActions: [
          {
            key: 'deploymentPlans',
            title: '应用资产部署',
            description: '从应用资产选择证书版本并发起部署。',
            path: '/applications',
            permission: 'service_asset.read',
          },
        ],
        statusGroups: [],
        certificateStatuses: [],
        recentAudits: [],
      },
    })

    const wrapper = mount(DashboardView, {
      attachTo: document.body,
      global: {
        stubs: {
          RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        },
      },
    })

    await vi.waitFor(() => expect(wrapper.findAll('.dashboard-quick-start__button')).toHaveLength(2))
    const quickStartButtons = wrapper.findAll('.dashboard-quick-start__button')
    expect(quickStartButtons[0].text()).toContain('导入或申请新证书')
    expect(quickStartButtons[0].element.tagName).toBe('BUTTON')
    await quickStartButtons[0].trigger('click')
    expect(document.querySelector('.certificate-add-modal__source')).not.toBeNull()
    expect(document.body.textContent).toContain('导入已有证书')
    expect(document.body.textContent).toContain('通过 ACME 申请证书')
    expect(wrapper.find('[data-testid="acme-request-modal"]').exists()).toBe(false)
    document.querySelectorAll<HTMLButtonElement>('.certificate-add-modal__source .gc-selection-card')[0]?.click()
    await vi.waitFor(() => expect(document.querySelector('.certificate-import-wizard')).not.toBeNull())
    expect(routerMocks.push).not.toHaveBeenCalled()
    expect(document.querySelector('.certificate-import-wizard__panel--source')).toBeNull()
    await quickStartButtons[0].trigger('click')
    document.querySelectorAll<HTMLButtonElement>('.certificate-add-modal__source .gc-selection-card')[1]?.click()
    await vi.waitFor(() => expect(wrapper.find('[data-testid="acme-request-modal"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="acme-request-modal"]').exists()).toBe(true)
    expect(quickStartButtons[1].text()).toContain('部署到网站或应用')
    expect(quickStartButtons[1].attributes('href')).toBe('/assets')
  })

  it('快捷启动不等待仪表盘总览请求即可同时显示两个入口', () => {
    usePermissionStore().setPermissions(['certificate.import', 'service_asset.read'])
    apiMocks.getDashboardOverview.mockImplementation(() => new Promise(() => undefined))

    const wrapper = mount(DashboardView)

    const quickStartButtons = wrapper.findAll('.dashboard-quick-start__button')
    expect(quickStartButtons).toHaveLength(2)
    expect(quickStartButtons[0].text()).toContain('导入或申请新证书')
    expect(quickStartButtons[1].text()).toContain('部署到网站或应用')
    expect(quickStartButtons[1].attributes('href')).toBe('/assets')
  })

  it('仅用最近审计事件时间聚合活动趋势，不生成示例静态数据', async () => {
    apiMocks.getDashboardOverview.mockResolvedValue({
      data: {
        generatedAt: '2026-07-06T08:34:00.000Z',
        systemResources: { cpuUsage: 22, memoryUsage: 41 },
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

    await vi.waitFor(() => expect(wrapper.find('.dashboard-panel--recent-log').exists()).toBe(true))
    expect(wrapper.find('[data-testid="dashboard-activity-chart"]').exists()).toBe(false)
    expect(wrapper.findAll('.dashboard-trend-card')).toHaveLength(3)
  })
})
