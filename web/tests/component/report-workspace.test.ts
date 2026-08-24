import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { usePermissionStore } from '@/stores/permission.store'
import ReportWorkspace from '@/views/reports/ReportWorkspace.vue'
import {
  createReportRun,
  downloadReportRun,
  getReportItems,
  getReportOverview,
  getReportTrends,
  listReportRuns
} from '@/api/modules/reports.api'

vi.mock('@/api/modules/reports.api', () => ({
  createReportRun: vi.fn(),
  downloadReportRun: vi.fn(),
  getReportItems: vi.fn(),
  getReportOverview: vi.fn(),
  getReportTrends: vi.fn(),
  listReportRuns: vi.fn()
}))

const overview = {
  reportType: 'incident_window' as const,
  asOf: '2026-07-21T08:00:00.000Z',
  metricVersions: { incident_window_active_count: 1 },
  metrics: [
    {
      metricKey: 'incident_window_active_count',
      metricVersion: 1,
      labelKey: 'reports.metrics.incident_window_active_count',
      value: 3,
      sampleCount: 3
    }
  ],
  groups: [
    { dimension: 'usage_status', value: 'in_use', count: 3 }
  ],
  warnings: []
}

describe('ReportWorkspace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getReportOverview).mockResolvedValue(overview)
    vi.mocked(getReportTrends).mockResolvedValue([
      { snapshotDate: '2026-07-21', complete: true, metrics: [] }
    ])
    vi.mocked(getReportItems).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
      asOf: '2026-07-21T08:00:00.000Z'
    })
    vi.mocked(listReportRuns).mockResolvedValue([])
    vi.mocked(downloadReportRun).mockResolvedValue()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('点击指标卡后使用同一 metricKey 请求对象下钻', async () => {
    usePermissionStore().setPermissions(['report.read'])
    const wrapper = mount(ReportWorkspace, {
      props: {
        reportType: 'incident_window',
        titleKey: 'reports.incidentWindow.title',
        descriptionKey: 'reports.incidentWindow.description'
      },
      global: { plugins: [i18n] }
    })

    await flushPromises()
    expect(getReportItems).toHaveBeenCalledWith('incident_window', expect.objectContaining({ metricKey: undefined }))

    await wrapper.get('.metric-card').trigger('click')
    await flushPromises()

    expect(getReportItems).toHaveBeenLastCalledWith(
      'incident_window',
      expect.objectContaining({ metricKey: 'incident_window_active_count' })
    )
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.text()).toContain('使用状态')
    expect(wrapper.text()).toContain('在用')
    expect(wrapper.attributes('aria-label')).toBeTruthy()
  })

  it('仅 report.export 权限展示导出并传递浏览器时区', async () => {
    usePermissionStore().setPermissions(['report.read', 'report.export'])
    vi.mocked(createReportRun).mockResolvedValue({
      id: 'run-1',
      reportType: 'incident_window',
      status: 'succeeded',
      timeZone: 'Asia/Shanghai',
      dataAsOf: '2026-07-21T08:00:00.000Z',
      createdAt: '2026-07-21T08:00:00.000Z'
    })
    const timeZoneSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
      resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' })
    }) as Intl.DateTimeFormat)
    const wrapper = mount(ReportWorkspace, {
      props: {
        reportType: 'incident_window',
        titleKey: 'reports.incidentWindow.title',
        descriptionKey: 'reports.incidentWindow.description'
      },
      global: { plugins: [i18n] }
    })

    await flushPromises()
    const exportButton = wrapper.findAll('button').find((button) => button.text().includes('CSV'))
    expect(exportButton).toBeTruthy()
    await exportButton!.trigger('click')
    await flushPromises()

    expect(createReportRun).toHaveBeenCalledWith(
      'incident_window',
      expect.objectContaining({ page: 1, pageSize: 100 }),
      'Asia/Shanghai'
    )
    expect(downloadReportRun).toHaveBeenCalledWith('run-1')
    timeZoneSpy.mockRestore()
  })

  it('应用筛选后统一请求摘要、趋势和下钻', async () => {
    usePermissionStore().setPermissions(['report.read'])
    const wrapper = mount(ReportWorkspace, {
      props: {
        reportType: 'incident_window',
        titleKey: 'reports.incidentWindow.title',
        descriptionKey: 'reports.incidentWindow.description'
      },
      global: { plugins: [i18n] }
    })

    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('prod')
    await inputs[1]!.setValue('owner_1')
    await inputs[3]!.setValue('critical')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const expected = expect.objectContaining({ environment: 'prod', ownerId: 'owner_1', tag: 'critical' })
    expect(getReportOverview).toHaveBeenLastCalledWith('incident_window', expected)
    expect(getReportTrends).toHaveBeenLastCalledWith('incident_window', expected)
    expect(getReportItems).toHaveBeenLastCalledWith('incident_window', expected)
  })
})
