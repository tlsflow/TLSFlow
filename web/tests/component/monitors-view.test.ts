import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'

const assetMocks = vi.hoisted(() => ({ listAssets: vi.fn() }))
const bindingMocks = vi.hoisted(() => ({ listBindings: vi.fn() }))
const certificateMocks = vi.hoisted(() => ({ listCertificates: vi.fn(), listCertificateVersions: vi.fn() }))
const monitorMocks = vi.hoisted(() => ({
  createMonitorTarget: vi.fn(),
  deleteMonitorTarget: vi.fn(),
  listMonitorCertificateObservations: vi.fn(),
  listMonitorProbeResults: vi.fn(),
  listMonitorTargets: vi.fn(),
  listRiskEvents: vi.fn(),
  probeMonitorServiceAsset: vi.fn(),
  scanMonitorRisks: vi.fn(),
  updateMonitorTarget: vi.fn(),
}))
const tlsMocks = vi.hoisted(() => ({ listTlsInspectorTargets: vi.fn() }))

vi.mock('@/api/modules/assets.api', () => assetMocks)
vi.mock('@/api/modules/bindings.api', () => bindingMocks)
vi.mock('@/api/modules/certificates.api', () => certificateMocks)
vi.mock('@/api/modules/monitors.api', () => monitorMocks)
vi.mock('@/api/modules/tls-inspector.api', () => tlsMocks)
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

import MonitorsView from '@/views/monitoring/MonitorsView.vue'

function page(items: readonly Record<string, unknown>[]) {
  return { data: { items, page: 1, pageSize: 200, total: items.length } }
}

describe('MonitorsView', () => {
  it('展示目标分栏并支持状态筛选和清空', async () => {
    assetMocks.listAssets.mockResolvedValue(page([
      { id: 'asset-1', displayName: 'a.example.com', address: 'https://a.example.com:443' },
    ]))
    bindingMocks.listBindings.mockResolvedValue(page([]))
    certificateMocks.listCertificates.mockResolvedValue(page([]))
    certificateMocks.listCertificateVersions.mockResolvedValue(page([]))
    monitorMocks.listMonitorTargets.mockResolvedValue(page([
      { id: 'target-1', serviceAssetId: 'asset-1', intervalSeconds: 60, metrics: ['availability'] },
    ]))
    monitorMocks.listMonitorProbeResults.mockResolvedValue(page([
      {
        serviceAssetId: 'asset-1',
        status: 'READY',
        latencyMs: 10,
        checkedAt: '2026-08-12T08:00:00.000Z',
      },
      {
        serviceAssetId: 'asset-1',
        status: 'READY',
        latencyMs: 18,
        checkedAt: '2026-08-12T08:01:00.000Z',
      },
    ]))
    monitorMocks.listMonitorCertificateObservations.mockResolvedValue(page([
      {
        serviceAssetId: 'asset-1',
        fingerprintSha256: 'AA:BB:CC:DD',
        subject: 'CN=a.example.com',
        issuer: 'CN=Example Issuer',
        serialNumber: 'serial-1',
        notBefore: 'invalid-date',
        notAfter: 'invalid-date',
        dnsNames: ['a.example.com'],
        checkedAt: '2026-08-12T08:01:00.000Z',
        source: 'control_plane',
      },
    ]))
    monitorMocks.listRiskEvents.mockResolvedValue(page([]))
    monitorMocks.scanMonitorRisks.mockResolvedValue({ data: {} })
    tlsMocks.listTlsInspectorTargets.mockResolvedValue(page([]))

    const wrapper = mount(MonitorsView, {
      global: { plugins: [i18n] },
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('.monitor-page__workspace').exists()).toBe(true)
    expect(wrapper.find('.monitor-page__target').text()).toContain('a.example.com')
    expect(wrapper.find('.monitor-page__detail').exists()).toBe(true)
    expect(wrapper.findAll('.gc-tag').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.monitor-page__probe-trend .gc-trend-chart__point')).toHaveLength(2)
    const certificateDetail = wrapper.find('.monitor-page__certificate-detail')
    expect(certificateDetail.text()).toContain(i18n.global.t('monitoring.fallback.notCollected'))
    expect(certificateDetail.text()).not.toContain('invalid-date')
    expect(certificateDetail.text()).toContain(i18n.global.t('certificates.detailPanel.fields.san'))
    expect(wrapper.find('.monitor-page__target-interval b').text()).toBe(
      i18n.global.t('monitoring.labels.secondsUnit'),
    )

    await wrapper.find('.monitor-page__filter-status select').setValue('ERROR')
    expect(wrapper.find('.monitor-page__target').exists()).toBe(false)
    expect(wrapper.find('.monitor-page__filtered-empty').exists()).toBe(true)
    await wrapper.find('.monitor-page__filter-reset').trigger('click')
    expect(wrapper.find('.monitor-page__target').exists()).toBe(true)
  })
})
