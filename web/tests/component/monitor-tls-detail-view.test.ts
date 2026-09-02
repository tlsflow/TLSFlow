import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'

const assetMocks = vi.hoisted(() => ({
  listApplications: vi.fn(),
}))

const monitorMocks = vi.hoisted(() => ({
  listMonitorTargets: vi.fn(),
}))

const tlsInspectorMocks = vi.hoisted(() => ({
  listTlsInspectorTargets: vi.fn(),
  createTlsInspectorTarget: vi.fn(),
  getLatestTlsInspection: vi.fn(),
  listTlsInspectionSnapshots: vi.fn(),
  runTlsInspection: vi.fn(),
  getTlsInspectionSnapshot: vi.fn(),
}))

vi.mock('@/api/modules/assets.api', () => ({
  listApplications: assetMocks.listApplications,
}))

vi.mock('@/api/modules/monitors.api', () => ({
  listMonitorTargets: monitorMocks.listMonitorTargets,
}))

vi.mock('@/api/modules/tls-inspector.api', () => ({
  listTlsInspectorTargets: tlsInspectorMocks.listTlsInspectorTargets,
  createTlsInspectorTarget: tlsInspectorMocks.createTlsInspectorTarget,
  getLatestTlsInspection: tlsInspectorMocks.getLatestTlsInspection,
  listTlsInspectionSnapshots: tlsInspectorMocks.listTlsInspectionSnapshots,
  runTlsInspection: tlsInspectorMocks.runTlsInspection,
  getTlsInspectionSnapshot: tlsInspectorMocks.getTlsInspectionSnapshot,
}))

import MonitorTlsDetailView from '@/views/monitoring/MonitorTlsDetailView.vue'

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_ok',
    timestamp: '2026-08-07T00:00:00.000Z',
  }
}

describe('MonitorTlsDetailView', () => {
  it('展示 TLS 深度详情并支持页签切换', async () => {
    assetMocks.listApplications.mockResolvedValue(okPage([
      { id: 'asset-1', displayName: 'a.example.com', address: 'https://a.example.com:443' },
    ]))
    monitorMocks.listMonitorTargets.mockResolvedValue(okPage([
      { id: 'target-1', serviceAssetId: 'asset-1', intervalSeconds: 300 },
    ]))
    tlsInspectorMocks.listTlsInspectorTargets.mockResolvedValue(okPage([
      {
        id: 'tls-target-1',
        serviceAssetId: 'asset-1',
        host: 'a.example.com',
        port: 443,
        serverName: 'a.example.com',
        status: 'active',
        schedule: { intervalSeconds: 300 },
      },
    ]))
    tlsInspectorMocks.createTlsInspectorTarget.mockResolvedValue({ data: null })
    tlsInspectorMocks.listTlsInspectionSnapshots.mockResolvedValue(okPage([
      {
        id: 'snap-1',
        targetId: 'tls-target-1',
        status: 'succeeded',
        startedAt: '2026-08-07T12:00:00.000Z',
        finishedAt: '2026-08-07T12:00:05.000Z',
        summary: { endpoint: 'a.example.com:443' },
        riskSummary: {
          legacyProtocolEnabled: true,
          weakCipherDetected: true,
          tls13Supported: false,
          hstsTooShort: true,
          trustPathIssueCount: 2,
          simulationFailedCount: 1,
          boundaryNotes: ['compatibility is simulated'],
        },
      },
    ]))
    const snapshot = {
      id: 'snap-1',
      tenantId: 'tenant-1',
      targetId: 'tls-target-1',
      startedAt: '2026-08-07T12:00:00.000Z',
      finishedAt: '2026-08-07T12:00:05.000Z',
      status: 'succeeded',
      summary: {
        endpoint: 'a.example.com:443',
        lastInspectedAt: '2026-08-07T12:00:05.000Z',
        certificateSubject: 'CN=a.example.com',
        expiresAt: '2026-12-31T00:00:00.000Z',
        legacyProtocolEnabled: true,
        weakCipherDetected: true,
        trustPathIssueCount: 2,
        simulationFailedCount: 1,
      },
      certificate: {
        subject: 'CN=a.example.com',
        issuer: 'CN=Example Root',
        notBefore: '2026-08-01T00:00:00.000Z',
        notAfter: '2026-12-31T00:00:00.000Z',
        subjectAltNames: ['a.example.com', 'www.a.example.com'],
        chain: [{ subject: 'CN=a.example.com', issuer: 'CN=Example Root' }],
      },
      trustPaths: [
        {
          view: 'mozilla',
          viewLabel: 'Mozilla',
          status: 'trusted',
          boundaryNote: 'node root store',
          path: [{ position: 1, source: 'server', subject: 'CN=a.example.com', issuer: 'CN=Example Root' }],
        },
      ],
      protocols: [
        { id: 'tls1_2', label: 'TLS 1.2', supported: true, negotiatedCipherSuite: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256' },
        { id: 'tls1_0', label: 'TLS 1.0', supported: true, negotiatedCipherSuite: 'TLS_RSA_WITH_AES_128_CBC_SHA' },
      ],
      cipherSuites: [
        { protocol: 'TLS 1.2', standardName: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', strengthBits: 128, forwardSecrecy: true, insecure: false, weak: false },
      ],
      simulations: [
        { profileId: 'chrome-131', profileName: 'Chrome 131 / Win 10', profileVersion: '2026.08.07', status: 'succeeded', protocol: 'TLS 1.2', cipherSuite: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', keyExchange: 'ECDH ECDH', forwardSecrecy: true, boundaryNote: 'simulated result' },
      ],
      protocolDetails: {
        alpn: 'http/1.1',
        ocspStapling: false,
        hsts: { enabled: true, maxAge: 172800, raw: 'max-age=172800' },
        httpStatus: 200,
        httpProtocol: 'HTTP/1.1',
        serverHeader: 'BWS/1.1',
        secureRenegotiation: true,
        sessionResumptionTickets: true,
        compression: false,
        pqcSupported: false,
        supportedNamedGroups: ['X25519'],
      },
      riskSummary: {
        legacyProtocolEnabled: true,
        weakCipherDetected: true,
        tls13Supported: false,
        hstsTooShort: true,
        trustPathIssueCount: 2,
        simulationFailedCount: 1,
        boundaryNotes: ['compatibility is simulated'],
      },
      implementationVersion: '2026.08.07',
      profileCatalogVersion: '2026.08.07',
      trustCatalogVersion: '2026.08.07',
    }
    tlsInspectorMocks.getLatestTlsInspection.mockResolvedValue({ data: snapshot })
    tlsInspectorMocks.runTlsInspection.mockResolvedValue({ data: snapshot })
    tlsInspectorMocks.getTlsInspectionSnapshot.mockResolvedValue({ data: snapshot })

    const wrapper = mount(MonitorTlsDetailView, {
      props: {
        monitorTargetId: 'target-1',
        embedded: true,
      },
      global: {
        plugins: [i18n],
      },
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('TLS深度检测结果')
    expect(wrapper.text()).toContain('a.example.com')
    expect(wrapper.text()).not.toContain('2026-08-07T12:00:05.000Z')
    expect(wrapper.text()).not.toContain('基于协议、证书链、兼容性和策略的近似报告')
    expect(wrapper.findAll('.tls-report-card__eyebrow').some((item) => item.text() === '重点发现')).toBe(false)
    expect(wrapper.findAll('.tls-inline-facts__item')).toHaveLength(2)
    expect(wrapper.find('.monitor-tls-page__header-grade').text()).toBe(wrapper.find('.tls-grade-panel__badge').text())

    const simulationTab = wrapper.findAll('button').find((item) => item.text().includes('握手模拟'))
    expect(simulationTab).toBeTruthy()
    await simulationTab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('ECDH')
    expect(wrapper.text()).not.toContain('ECDH ECDH')
    expect(wrapper.find('.tls-table--simulation tbody tr td:nth-child(6) .tls-table__subtle').exists()).toBe(false)

    const trustTab = wrapper.findAll('button').find((item) => item.text().includes('证书认证路径'))
    expect(trustTab).toBeTruthy()
    await trustTab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Mozilla')

    const protocolTab = wrapper.findAll('button').find((item) => item.text().includes('协议与套件'))
    expect(protocolTab).toBeTruthy()
    await protocolTab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256')

    const detailTab = wrapper.findAll('button').find((item) => item.text().includes('协议细节'))
    expect(detailTab).toBeTruthy()
    await detailTab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('max-age=172800')
    expect(wrapper.text()).toContain('BWS/1.1')
  })

  it('最新检测失败时回退展示上一条可用快照', async () => {
    assetMocks.listApplications.mockResolvedValue(okPage([
      { id: 'asset-1', displayName: 'a.example.com', address: 'https://a.example.com:443' },
    ]))
    monitorMocks.listMonitorTargets.mockResolvedValue(okPage([
      { id: 'target-1', serviceAssetId: 'asset-1', intervalSeconds: 300 },
    ]))
    tlsInspectorMocks.listTlsInspectorTargets.mockResolvedValue(okPage([
      {
        id: 'tls-target-1',
        serviceAssetId: 'asset-1',
        host: 'a.example.com',
        port: 443,
        status: 'active',
        schedule: { intervalSeconds: 86_400 },
      },
    ]))
    tlsInspectorMocks.getLatestTlsInspection.mockResolvedValue({
      data: { id: 'failed-snapshot', targetId: 'tls-target-1', status: 'failed' },
    })
    tlsInspectorMocks.listTlsInspectionSnapshots.mockResolvedValue(okPage([
      { id: 'usable-snapshot', targetId: 'tls-target-1', status: 'succeeded' },
    ]))
    tlsInspectorMocks.getTlsInspectionSnapshot.mockResolvedValue({
      data: {
        id: 'usable-snapshot',
        tenantId: 'tenant-1',
        targetId: 'tls-target-1',
        status: 'succeeded',
        startedAt: '2026-08-07T12:00:00.000Z',
        finishedAt: '2026-08-07T12:00:05.000Z',
        summary: { endpoint: 'a.example.com:443' },
        certificate: { subject: 'CN=a.example.com' },
        trustPaths: [],
        protocols: [],
        cipherSuites: [],
        simulations: [],
        protocolDetails: {},
        riskSummary: {
          legacyProtocolEnabled: false,
          weakCipherDetected: false,
          tls13Supported: false,
          hstsTooShort: false,
          trustPathIssueCount: 0,
          trustPathUnsupportedCount: 0,
          simulationFailedCount: 0,
          boundaryNotes: [],
        },
        implementationVersion: '2026.08.07',
      },
    })

    const wrapper = mount(MonitorTlsDetailView, {
      props: { monitorTargetId: 'target-1', embedded: true },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    await flushPromises()

    expect(tlsInspectorMocks.listTlsInspectionSnapshots).toHaveBeenCalledWith('tls-target-1', { page: 1, pageSize: 20 })
    expect(tlsInspectorMocks.getTlsInspectionSnapshot).toHaveBeenCalledWith('usable-snapshot')
    expect(wrapper.text()).toContain('基础信息13')
    expect(wrapper.find('.tls-report-page__inline-error').exists()).toBe(false)
  })
})
